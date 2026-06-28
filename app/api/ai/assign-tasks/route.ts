 import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { assignTasksPrompt } from '@/lib/ai/prompts';

interface RequestBody {
  projectId: string;
}

interface Assignment {
  taskId: string;
  assigneeId: string;
  reason: string;
}

export async function POST(request: NextRequest) {
  // ── 1. 세션 확인 ──────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  // ── 2. 요청 body 파싱 ─────────────────────────────────────────────────────
  let body: RequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: '잘못된 요청입니다.' }, { status: 400 });
  }

  const { projectId } = body;

  // ── 3. 프로젝트 조회 및 owner 확인 ───────────────────────────────────────
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, owner_id, status')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { error: '프로젝트를 찾을 수 없습니다.' },
      { status: 404 },
    );
  }

  if (project.owner_id !== user.id) {
    return NextResponse.json(
      { error: '접근 권한이 없습니다.' },
      { status: 403 },
    );
  }

  // ── 4. 프로젝트 상태 확인 ─────────────────────────────────────────────────
  if (project.status !== 'selecting') {
    return NextResponse.json(
      { error: '태스크 선택 단계(selecting)인 프로젝트에서만 AI 배정을 실행할 수 있습니다.' },
      { status: 400 },
    );
  }

  // ── 5. 미배정 태스크 조회 ─────────────────────────────────────────────────
  const { data: unclaimedTasksRaw } = await supabase
    .from('tasks')
    .select('id, title, suggested_role, due_date')
    .eq('project_id', projectId)
    .is('assignee_id', null);

  // ── 6. 팀원 조회 ──────────────────────────────────────────────────────────
  const { data: membersRaw } = await supabase
    .from('project_members')
    .select('user_id, role_preference, users(id, name, email)')
    .eq('project_id', projectId);

  // 각 팀원이 이미 맡은 태스크 제목 목록 계산
  const { data: assignedTasksRaw } = await supabase
    .from('tasks')
    .select('assignee_id, title')
    .eq('project_id', projectId)
    .not('assignee_id', 'is', null);

  const memberTasksMap: Record<string, string[]> = {};
  if (assignedTasksRaw) {
    for (const t of assignedTasksRaw) {
      if (t.assignee_id) {
        if (!memberTasksMap[t.assignee_id]) memberTasksMap[t.assignee_id] = [];
        memberTasksMap[t.assignee_id].push(t.title);
      }
    }
  }

  const members = (membersRaw ?? []).map((m: any) => {
    const u = Array.isArray(m.users) ? m.users[0] : m.users;
    return {
      userId: m.user_id,
      name: u?.name ?? u?.email ?? '알 수 없음',
      rolePreference: m.role_preference ?? 'any',
      currentTasks: memberTasksMap[m.user_id] ?? [],
    };
  });

  // ── 7. 미배정 태스크 없으면 바로 active 전환 ─────────────────────────────
  if (!unclaimedTasksRaw || unclaimedTasksRaw.length === 0) {
    await supabase
      .from('projects')
      .update({ status: 'active' })
      .eq('id', projectId);

    return NextResponse.json(
      { success: true, summary: '미배정 태스크가 없어 프로젝트를 바로 시작합니다.' },
      { status: 200 },
    );
  }

  const unclaimedTasks = unclaimedTasksRaw.map((t: any) => ({
    id: t.id,
    title: t.title,
    suggestedRole: t.suggested_role ?? 'any',
    dueDate: t.due_date,
  }));

  // ── 8. 팀원이 없으면 배정 불가 ───────────────────────────────────────────
  if (members.length === 0) {
    return NextResponse.json(
      { error: '배정할 팀원이 없습니다.' },
      { status: 400 },
    );
  }

  // ── 9. 프롬프트 생성 ──────────────────────────────────────────────────────
  const { system, user: userPrompt } = assignTasksPrompt({
    unclaimedTasks,
    members,
  });

  // ── 10. AI 호출 ───────────────────────────────────────────────────────────
  let rawText: string;
  try {
    const anthropic = new Anthropic({
      baseURL: process.env.AI_API_BASE_URL,
      apiKey: process.env.AI_API_KEY,
    });

    const message = await anthropic.messages.create({
      model: process.env.AI_MODEL ?? 'claude-3-5-haiku-20241022',
      max_tokens: 4000,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from AI');
    }
    rawText = content.text;
  } catch (error) {
    console.error('=== ASSIGN ERROR ===', error);
    return NextResponse.json(
      { error: 'AI 호출에 실패했어요.' },
      { status: 500 },
    );
  }

  // ── 11. 응답 파싱 ─────────────────────────────────────────────────────────
  let assignments: Assignment[];
  let summary: string;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned) as {
      assignments: Assignment[];
      summary: string;
    };
    assignments = parsed.assignments;
    summary = parsed.summary;
  } catch {
    console.error('=== ASSIGN RAW ===', rawText);
    return NextResponse.json(
      { error: 'AI 응답 파싱에 실패했어요.' },
      { status: 500 },
    );
  }

  // ── 12. tasks UPDATE (assignee_id 배정) ───────────────────────────────────
  const updatePromises = assignments.map(({ taskId, assigneeId }) =>
    supabase
      .from('tasks')
      .update({ assignee_id: assigneeId })
      .eq('id', taskId)
      .eq('project_id', projectId),
  );

  await Promise.all(updatePromises);

  // ── 13. 프로젝트 status → 'active' ───────────────────────────────────────
  await supabase
    .from('projects')
    .update({ status: 'active' })
    .eq('id', projectId);

  return NextResponse.json({ success: true, summary }, { status: 200 });
}
