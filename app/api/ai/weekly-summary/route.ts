import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { weeklySummaryPrompt } from '@/lib/ai/prompts';
import { callAI } from '@/lib/ai/client';

interface RequestBody {
  projectId: string;
}

// 중복 생성 방지: 마지막 요약이 이 시간(ms) 이내면 새로 생성하지 않음
const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1시간

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

  if (!projectId) {
    return NextResponse.json({ error: '프로젝트 ID가 필요합니다.' }, { status: 400 });
  }

  // ── 3. 프로젝트 조회 ──────────────────────────────────────────────────────
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, owner_id, deadline')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { error: '프로젝트를 찾을 수 없습니다.' },
      { status: 404 },
    );
  }

  // ── 4. 접근 권한 확인 (owner 또는 project_members) ───────────────────────
  const isOwner = project.owner_id === user.id;
  if (!isOwner) {
    const { data: membership } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (!membership) {
      return NextResponse.json(
        { error: '접근 권한이 없습니다.' },
        { status: 403 },
      );
    }
  }

  // ── 5. 중복 생성 방지: 마지막 요약이 1시간 이내면 그대로 반환 ─────────────
  const { data: lastSummary } = await supabase
    .from('project_summaries')
    .select('id, content, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastSummary) {
    const elapsed = Date.now() - new Date(lastSummary.created_at).getTime();
    if (elapsed < MIN_INTERVAL_MS) {
      return NextResponse.json(
        { summary: lastSummary, reused: true },
        { status: 200 },
      );
    }
  }

  // ── 6. 태스크 목록 조회 (제목, 상태, 마감일, 담당자) ─────────────────────
  const { data: tasksRaw } = await supabase
    .from('tasks')
    .select('id, title, status, due_date, assignee_id')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  // ── 7. 담당자 이름 조회 ───────────────────────────────────────────────────
  const assigneeIds = [
    ...new Set((tasksRaw ?? []).map((t) => t.assignee_id).filter(Boolean) as string[]),
  ];

  const nameMap: Record<string, string> = {};
  if (assigneeIds.length > 0) {
    const { data: usersRaw } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', assigneeIds);

    (usersRaw ?? []).forEach((u) => {
      nameMap[u.id] = u.name ?? u.email ?? '알 수 없음';
    });
  }

  const tasks = (tasksRaw ?? []).map((t) => ({
    title: t.title,
    status: t.status as 'pending' | 'in_progress' | 'completed',
    dueDate: t.due_date,
    assigneeName: t.assignee_id ? (nameMap[t.assignee_id] ?? '알 수 없음') : null,
  }));

  // ── 8. 최근 상태 변경 이력 조회 (최근 20건) ───────────────────────────────
  const taskIds = (tasksRaw ?? []).map((t) => t.id);
  let statusHistory: { taskTitle: string; fromStatus: string; toStatus: string; createdAt: string }[] = [];

  if (taskIds.length > 0) {
    const { data: historyRaw } = await supabase
      .from('task_status_history')
      .select('task_id, from_status, to_status, created_at')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
      .limit(20);

    const taskTitleMap: Record<string, string> = {};
    (tasksRaw ?? []).forEach((t) => {
      taskTitleMap[t.id] = t.title;
    });

    statusHistory = (historyRaw ?? []).map((h) => ({
      taskTitle: taskTitleMap[h.task_id] ?? '알 수 없는 태스크',
      fromStatus: h.from_status,
      toStatus: h.to_status,
      createdAt: h.created_at,
    }));
  }

  // ── 9. 프롬프트 생성 ──────────────────────────────────────────────────────
  const { system, user: userPrompt } = weeklySummaryPrompt({
    tasks,
    statusHistory,
    deadline: project.deadline ?? null,
  });

  // ── 10. AI 호출 (Gemini 메인 + Groq 폴백) ────────────────────────────────
  let rawText: string;
  try {
    rawText = await callAI({
      system,
      user: userPrompt,
      maxTokens: 2000,
      validate: (t) => {
        try {
          const cleaned = t
            .replace(/^```(?:json)?\s*/i, '')
            .replace(/\s*```$/, '')
            .trim();
          JSON.parse(cleaned);
          return true;
        } catch {
          return false;
        }
      },
    });
  } catch {
    return NextResponse.json({ error: 'AI 호출에 실패했어요.' }, { status: 500 });
  }

  // ── 11. JSON 파싱 ─────────────────────────────────────────────────────────
  let summaryText: string;
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned) as { summary: string };
    summaryText = parsed.summary;

    if (!summaryText || typeof summaryText !== 'string') {
      throw new Error('summary 필드가 없거나 문자열이 아닙니다.');
    }
  } catch (e) {
    console.error('[파싱실패] 원본 응답:', rawText);
    console.error('[파싱실패] 에러:', e);
    return NextResponse.json(
      { error: 'AI 응답 파싱에 실패했어요.' },
      { status: 500 },
    );
  }

  // ── 12. project_summaries에 insert ───────────────────────────────────────
  const { data: inserted, error: insertError } = await supabase
    .from('project_summaries')
    .insert({
      project_id: projectId,
      content: summaryText,
    })
    .select('id, content, created_at')
    .single();

  if (insertError || !inserted) {
    console.error('[insert실패]', insertError);
    return NextResponse.json(
      { error: '요약 저장에 실패했어요.' },
      { status: 500 },
    );
  }

  return NextResponse.json({ summary: inserted, reused: false }, { status: 200 });
}
