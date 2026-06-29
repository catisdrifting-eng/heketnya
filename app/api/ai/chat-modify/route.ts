import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { chatModifyPrompt } from '@/lib/ai/prompts';
import { callAI } from '@/lib/ai/client';

interface RoadmapTask {
  title: string;
  description: string | null;
  dueDate: string;
  suggestedRole: string;
  sortOrder: number;
}

interface RequestBody {
  projectId: string;
  currentTasks: RoadmapTask[];
  userMessage: string;
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

  const { projectId, currentTasks, userMessage } = body;

  // ── 3. 프로젝트 조회 및 owner 확인 ───────────────────────────────────────
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, owner_id, status, custom_roles, deadline, team_size')
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
  if (project.status !== 'setup') {
    return NextResponse.json(
      { error: '로드맵 편집은 setup 단계에서만 가능합니다.' },
      { status: 400 },
    );
  }

  // ── 5. 프롬프트 생성 ──────────────────────────────────────────────────────
  const { system, user: userPrompt } = chatModifyPrompt({
    currentTasks,
    roles: (project.custom_roles as { id: string; label: string }[]) ?? [],
    userMessage,
    deadline: project.deadline ?? '',
    teamSize: project.team_size ?? 1,
  });

  // ── 6. AI 호출 (Gemini 메인 + Groq 폴백) ──────────────────────────────────
  let rawText: string;
  try {
    rawText = await callAI({ system, user: userPrompt, maxTokens: 8000 });
  } catch {
    return NextResponse.json({ error: 'AI 호출에 실패했어요.' }, { status: 500 });
  }

  // ── 7. JSON 파싱 ──────────────────────────────────────────────────────────
  try {
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned) as {
      tasks: RoadmapTask[];
      summary: string;
    };

    return NextResponse.json(
      { tasks: parsed.tasks, summary: parsed.summary },
      { status: 200 },
    );
  } catch (e) {
    console.error('[파싱실패] 원본 응답:', rawText);
    console.error('[파싱실패] 에러:', e);
    return NextResponse.json(
      { error: 'AI 응답 파싱에 실패했어요.' },
      { status: 500 },
    );
  }
}
