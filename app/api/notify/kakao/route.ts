import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

interface RequestBody {
  projectId: string;
}

interface DueTask {
  title: string;
  due_date: string; // 'YYYY-MM-DD'
}

const KAKAO_TALK_MEMO_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';
const KAKAO_TEXT_LIMIT = 200;

// ── 마감까지 남은 일수 계산 (일 단위 자정 기준) ──────────────────────────────
function diffDays(dueDateStr: string, today: Date): number {
  const due = new Date(dueDateStr);
  due.setHours(0, 0, 0, 0);
  const diffMs = due.getTime() - today.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

// ── 분류 그룹 정의 ────────────────────────────────────────────────────────
type BucketKey = 'overdue' | 'within1' | 'within3' | 'within7';

const BUCKET_LABELS: Record<BucketKey, string> = {
  overdue: '⏰ 마감 지남',
  within1: '🔴 1일 이내',
  within3: '🟠 3일 이내',
  within7: '🟡 7일 이내',
};

function bucketFor(days: number): BucketKey | null {
  if (days < 0) return 'overdue';
  if (days <= 1) return 'within1';
  if (days <= 3) return 'within3';
  if (days <= 7) return 'within7';
  return null;
}

// ── 메시지 조립 (200자 제한 준수) ────────────────────────────────────────
function buildMessage(projectName: string, buckets: Record<BucketKey, DueTask[]>): string {
  const order: BucketKey[] = ['overdue', 'within1', 'within3', 'within7'];

  let header = `📌 [${projectName}] 일정 알림\n`;
  let body = '';

  for (const key of order) {
    const tasks = buckets[key];
    if (tasks.length === 0) continue;

    const titles = tasks.map((t) => `- ${t.title}`).join('\n');
    body += `\n${BUCKET_LABELS[key]} (${tasks.length})\n${titles}\n`;
  }

  let message = (header + body).trim();

  if (message.length > KAKAO_TEXT_LIMIT) {
    // 초과 시 요약: 그룹별 개수만 표기
    const summaryParts = order
      .filter((key) => buckets[key].length > 0)
      .map((key) => `${BUCKET_LABELS[key]} ${buckets[key].length}건`);
    message = `${header}${summaryParts.join(' · ')}`;

    if (message.length > KAKAO_TEXT_LIMIT) {
      message = message.slice(0, KAKAO_TEXT_LIMIT - 1) + '…';
    }
  }

  return message;
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

  // ── 2. 카카오 로그인 사용자 확인 ──────────────────────────────────────────
  const {
    data: { session },
  } = await supabase.auth.getSession();

  const provider = user.app_metadata?.provider;
  const providerToken = session?.provider_token;

  if (provider !== 'kakao' || !providerToken) {
    return NextResponse.json(
      { error: '카카오 로그인 사용자만 카카오톡 알림을 받을 수 있어요.' },
      { status: 400 },
    );
  }

  // ── 3. 요청 body 파싱 ─────────────────────────────────────────────────────
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

  // ── 4. 프로젝트 조회 ──────────────────────────────────────────────────────
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name')
    .eq('id', projectId)
    .single();

  if (projectError || !project) {
    return NextResponse.json(
      { error: '프로젝트를 찾을 수 없습니다.' },
      { status: 404 },
    );
  }

  // ── 5. 오늘 기준 날짜 (자정) ──────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const in7Days = new Date(today);
  in7Days.setDate(in7Days.getDate() + 7);

  // ── 6. 담당 태스크 조회: status != completed, due_date <= 오늘+7일 (지난 것 포함) ──
  const { data: tasksRaw, error: tasksError } = await supabase
    .from('tasks')
    .select('title, due_date, status')
    .eq('project_id', projectId)
    .eq('assignee_id', user.id)
    .neq('status', 'completed')
    .not('due_date', 'is', null)
    .lte('due_date', in7Days.toISOString().slice(0, 10))
    .order('due_date', { ascending: true });

  if (tasksError) {
    return NextResponse.json(
      { error: '태스크 조회에 실패했습니다.' },
      { status: 500 },
    );
  }

  const tasks = (tasksRaw ?? []) as { title: string; due_date: string; status: string }[];

  if (tasks.length === 0) {
    return NextResponse.json(
      { success: true, notified: false, message: '발송할 임박 일정이 없어요.' },
      { status: 200 },
    );
  }

  // ── 7. 마감까지 남은 일수로 분류 ──────────────────────────────────────────
  const buckets: Record<BucketKey, DueTask[]> = {
    overdue: [],
    within1: [],
    within3: [],
    within7: [],
  };

  for (const task of tasks) {
    const days = diffDays(task.due_date, today);
    const key = bucketFor(days);
    if (key) {
      buckets[key].push({ title: task.title, due_date: task.due_date });
    }
  }

  const hasAny = Object.values(buckets).some((arr) => arr.length > 0);
  if (!hasAny) {
    return NextResponse.json(
      { success: true, notified: false, message: '발송할 임박 일정이 없어요.' },
      { status: 200 },
    );
  }

  // ── 8. 메시지 조립 ────────────────────────────────────────────────────────
  const messageText = buildMessage(project.name, buckets);
  const projectUrl = `${process.env.NEXT_PUBLIC_APP_URL}/project/${projectId}`;

  // ── 9. 카카오 "나에게 보내기" API 호출 ───────────────────────────────────
  const templateObject = {
    object_type: 'text',
    text: messageText,
    link: {
      web_url: projectUrl,
      mobile_web_url: projectUrl,
    },
    button_title: '프로젝트 보기',
  };

  const kakaoRes = await fetch(KAKAO_TALK_MEMO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${providerToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    }),
  });

  if (!kakaoRes.ok) {
    const errText = await kakaoRes.text();
    console.error('[카카오 나에게 보내기 실패]', kakaoRes.status, errText);

    if (kakaoRes.status === 401) {
      return NextResponse.json(
        { error: '카카오 인증이 만료되었어요. 다시 로그인해주세요.' },
        { status: 401 },
      );
    }

    return NextResponse.json(
      { error: '카카오톡 메시지 발송에 실패했어요.' },
      { status: 502 },
    );
  }

  return NextResponse.json(
    { success: true, notified: true, taskCount: tasks.length },
    { status: 200 },
  );
}
