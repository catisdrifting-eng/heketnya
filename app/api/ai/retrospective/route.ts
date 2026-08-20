import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callAI } from '@/lib/ai/client';

interface RequestBody {
  projectId: string;
}

interface AIResult {
  summary?: unknown;
  went_well?: unknown;
  challenges?: unknown;
  learnings?: unknown;
}

function cleanJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

// 메시지 본문의 @[이름](uuid) 형식을 @이름 으로 변환한다.
function stripMentions(text: string): string {
  return text.replace(/@\[([^\]]+)\]\([0-9a-fA-F-]+\)/g, '@$1');
}

function toStringArray(value: unknown, max: number): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').slice(0, max);
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

  if (!projectId) {
    return NextResponse.json({ error: '프로젝트 ID가 필요합니다.' }, { status: 400 });
  }

  // ── 3. 프로젝트 조회 ──────────────────────────────────────────────────────
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, description, deadline, owner_id, status, created_at')
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
    const { data: membership, error: membershipError } = await supabase
      .from('project_members')
      .select('user_id')
      .eq('project_id', projectId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (membershipError) {
      console.error('[멤버십조회실패]', membershipError);
      return NextResponse.json({ error: '접근 권한 확인에 실패했습니다.' }, { status: 500 });
    }

    if (!membership) {
      return NextResponse.json(
        { error: '접근 권한이 없습니다.' },
        { status: 403 },
      );
    }
  }

  // ── 5. 완료 상태 확인 ──────────────────────────────────────────────────────
  if (project.status !== 'completed') {
    return NextResponse.json({ error: 'not_completed' }, { status: 400 });
  }

  // ── 6. 태스크 목록 조회 (deleted_at 이 null 인 것만) ──────────────────────
  const { data: tasksRaw, error: tasksError } = await supabase
    .from('tasks')
    .select('id, title, status, due_date, assignee_id')
    .eq('project_id', projectId)
    .is('deleted_at', null);

  if (tasksError) {
    console.error('[태스크조회실패]', tasksError);
    return NextResponse.json({ error: '태스크 조회에 실패했습니다.' }, { status: 500 });
  }

  const tasks = tasksRaw ?? [];

  // ── 7. 서버 통계 계산 ─────────────────────────────────────────────────────
  const totalTasks = tasks.length;
  const completedTasks = tasks.filter((t) => t.status === 'completed').length;
  const overdueTasks = project.deadline
    ? tasks.filter(
        (t) =>
          t.status !== 'completed' &&
          !!t.due_date &&
          new Date(t.due_date).getTime() < new Date(project.deadline as string).getTime(),
      ).length
    : 0;

  // ── 8. 멤버 수 조회 ────────────────────────────────────────────────────────
  const { data: membersRaw, error: membersError } = await supabase
    .from('project_members')
    .select('id, user_id')
    .eq('project_id', projectId);

  if (membersError) {
    console.error('[멤버조회실패]', membersError);
    return NextResponse.json({ error: '멤버 조회에 실패했습니다.' }, { status: 500 });
  }

  const memberCount = (membersRaw ?? []).length;

  // ── 9. 메시지 수 조회 (전체) + 최근 100건 (AI 자료용) ─────────────────────
  const { count: messageCount, error: messageCountError } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId);

  if (messageCountError) {
    console.error('[메시지수조회실패]', messageCountError);
    return NextResponse.json({ error: '메시지 조회에 실패했습니다.' }, { status: 500 });
  }

  const { data: messagesRaw, error: messagesError } = await supabase
    .from('messages')
    .select('id, content, user_id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (messagesError) {
    console.error('[메시지조회실패]', messagesError);
    return NextResponse.json({ error: '메시지 조회에 실패했습니다.' }, { status: 500 });
  }

  const messages = (messagesRaw ?? []).slice().reverse();

  // ── 10. durationDays 계산 ────────────────────────────────────────────────
  const durationDays = Math.max(
    0,
    Math.floor(
      (Date.now() - new Date(project.created_at).getTime()) / (1000 * 60 * 60 * 24),
    ),
  );

  const stats = {
    totalTasks,
    completedTasks,
    overdueTasks,
    memberCount,
    messageCount: messageCount ?? 0,
    durationDays,
  };

  // ── 11. 이름 조회 (태스크 담당자 + 메시지 발신자) ─────────────────────────
  const userIds = [
    ...new Set(
      [
        ...tasks.map((t) => t.assignee_id),
        ...messages.map((m) => m.user_id),
      ].filter(Boolean) as string[],
    ),
  ];

  const nameMap: Record<string, string> = {};
  if (userIds.length > 0) {
    const { data: usersRaw, error: usersError } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', userIds);

    if (usersError) {
      console.error('[사용자조회실패]', usersError);
      return NextResponse.json({ error: '사용자 조회에 실패했습니다.' }, { status: 500 });
    }

    (usersRaw ?? []).forEach((u) => {
      nameMap[u.id] = u.name ?? u.email ?? '알 수 없음';
    });
  }

  // ── 12. AI 에 넘길 태스크 목록 구성 ────────────────────────────────────────
  const taskList = tasks.map((t) => ({
    title: t.title,
    status: t.status,
    dueDate: t.due_date,
    assigneeName: t.assignee_id ? (nameMap[t.assignee_id] ?? '알 수 없음') : null,
  }));

  // ── 13. AI 에 넘길 채팅 로그 구성 (멘션 치환 포함) ─────────────────────────
  const chatLog = messages.map((m) => ({
    sender: m.user_id ? (nameMap[m.user_id] ?? '알 수 없음') : '알 수 없음',
    content: stripMentions(m.content ?? ''),
    createdAt: m.created_at,
  }));

  // ── 14. 프롬프트 생성 ─────────────────────────────────────────────────────
  const system = `당신은 완료된 팀 프로젝트를 돌아보고 회고를 작성하는 프로젝트 코디네이터입니다.
반드시 유효한 JSON만 출력합니다. 마크다운, 코드블록, 설명 없이 JSON 객체만 반환합니다.

규칙:
- 대화와 태스크 기록에 실제로 드러난 내용만 써라. 없는 일을 지어내지 마라.
- 특정 개인을 평가하거나 비교하지 마라. 누가 잘했다 못했다는 서술을 절대 하지 마라.
  주어는 항상 팀이다. 팀이 무엇을 했고 무엇을 배웠는지로 써라.
- challenges 는 사람이 아니라 상황과 과정을 대상으로 써라.
  예: "슬라이드 분량이 발표 시간에 안 맞아 리허설 후 조정이 필요했다"
- learnings 는 다음에 실제로 바꿀 수 있는 행동으로 써라. 교훈조의 훈계를 쓰지 마라.
- 각 배열 항목은 60자 이내로 써라.
- 각 배열은 2~4개가 적당하다. 없으면 빈 배열로 두어라.
- 설명하지 말고 JSON 만 출력하라.`;

  const userPrompt = `# 프로젝트 정보
- 이름: ${project.name}
- 설명: ${project.description ?? '(설명 없음)'}
- 마감일: ${project.deadline ?? '(마감일 없음)'}

# 통계
${JSON.stringify(stats, null, 2)}

# 태스크 목록
${JSON.stringify(taskList, null, 2)}

# 채팅 로그 (오래된 순)
${JSON.stringify(chatLog, null, 2)}

# 출력 형식 (이 구조 그대로)
{
  "summary": "이 프로젝트가 어떻게 진행됐는지 3문장 이내",
  "went_well": ["잘 풀린 것 한 줄", "..."],
  "challenges": ["막혔던 것 한 줄", "..."],
  "learnings": ["다음 프로젝트에 적용할 것 한 줄", "..."]
}

JSON만 출력하세요.`;

  // ── 15. AI 호출 ───────────────────────────────────────────────────────────
  let rawText: string;
  try {
    rawText = await callAI({
      system,
      user: userPrompt,
      maxTokens: 2000,
      validate: (t) => {
        try {
          const cleaned = cleanJsonFence(t);
          JSON.parse(cleaned);
          return true;
        } catch {
          return false;
        }
      },
    });
  } catch {
    return NextResponse.json({ error: 'ai_failed' }, { status: 500 });
  }

  // ── 16. JSON 파싱 ─────────────────────────────────────────────────────────
  let parsed: AIResult;
  try {
    const cleaned = cleanJsonFence(rawText);
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[파싱실패] 원본 응답:', rawText);
    console.error('[파싱실패] 에러:', e);
    return NextResponse.json({ error: 'ai_failed' }, { status: 500 });
  }

  // ── 17. 서버 검증 ─────────────────────────────────────────────────────────
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const went_well = toStringArray(parsed.went_well, 6);
  const challenges = toStringArray(parsed.challenges, 6);
  const learnings = toStringArray(parsed.learnings, 6);

  return NextResponse.json(
    { summary, went_well, challenges, learnings, stats },
    { status: 200 },
  );
}
