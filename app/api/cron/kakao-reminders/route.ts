import { NextResponse, type NextRequest } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getValidKakaoAccessToken } from '@/lib/kakao/token';

export const dynamic = 'force-dynamic';

interface TaskRow {
  title: string;
  due_date: string; // 'YYYY-MM-DD'
  assignee_id: string;
  projects: { name: string } | { name: string }[] | null;
}

const KAKAO_TALK_MEMO_URL = 'https://kapi.kakao.com/v2/api/talk/memo/default/send';
const KAKAO_TEXT_LIMIT = 200;
const MAX_ITEMS = 10;
const OFFSETS = [0, 1, 3, 7];

// ── 프로젝트명 정규화 (조인 결과가 객체/배열 어느 쪽이든 처리) ────────────────
function getProjectName(projects: TaskRow['projects']): string {
  if (!projects) return '프로젝트';
  if (Array.isArray(projects)) return projects[0]?.name ?? '프로젝트';
  return projects.name ?? '프로젝트';
}

// ── 마감일 라벨 (오늘/내일/3일 뒤/7일 뒤) ────────────────────────────────
function dueLabel(dueDate: string, dateByOffset: Map<string, number>): string {
  const offset = dateByOffset.get(dueDate) ?? 0;
  if (offset === 0) return '오늘 마감';
  if (offset === 1) return '내일 마감';
  return `${offset}일 뒤 마감`;
}

// ── 담당자별 메시지 본문 조립 ────────────────────────────────────────────
function buildMessage(
  dateByOffset: Map<string, number>,
  tasksByProject: Map<string, { title: string; due_date: string }[]>,
): string {
  const lines: string[] = [];
  let totalCount = 0;
  let includedCount = 0;

  for (const [projectName, tasks] of tasksByProject.entries()) {
    totalCount += tasks.length;
    lines.push(`[${projectName}] 마감이 다가온 일이 ${tasks.length}개 있어요.`);

    const sorted = [...tasks].sort(
      (a, b) => (dateByOffset.get(a.due_date) ?? 0) - (dateByOffset.get(b.due_date) ?? 0),
    );

    for (const task of sorted) {
      if (includedCount >= MAX_ITEMS) break;
      const label = dueLabel(task.due_date, dateByOffset);
      lines.push(`- ${task.title} (${label})`);
      includedCount++;
    }
  }

  if (totalCount > MAX_ITEMS) {
    lines.push(`…외 ${totalCount - MAX_ITEMS}건`);
  }

  let message = lines.join('\n');

  if (message.length > KAKAO_TEXT_LIMIT) {
    message = message.slice(0, KAKAO_TEXT_LIMIT - 1) + '…';
  }

  return message;
}

// ── 카카오톡 "나에게 보내기" 발송 ────────────────────────────────────────
async function sendKakaoMemo(accessToken: string, templateObject: object) {
  return fetch(KAKAO_TALK_MEMO_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      template_object: JSON.stringify(templateObject),
    }),
  });
}

export async function GET(request: NextRequest) {
  // ── 1. 인증 확인 ──────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');

  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  // ── 2. 한국 시간(UTC+9) 기준 오늘 + offset(0,1,3,7) 날짜 계산 ────────────
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000);

  const dateByOffset = new Map<string, number>();
  const targetDates: string[] = [];

  for (const offset of OFFSETS) {
    const targetDate = new Date(kst.getTime() + offset * 24 * 60 * 60 * 1000);
    const dateStr = targetDate.toISOString().slice(0, 10);
    dateByOffset.set(dateStr, offset);
    targetDates.push(dateStr);
  }

  const supabase = createAdminClient();

  // ── 3. 마감 임박 미완료 태스크 조회 ───────────────────────────────────────
  const { data: tasksRaw, error: tasksError } = await supabase
    .from('tasks')
    .select('title, due_date, assignee_id, projects(name)')
    .is('deleted_at', null)
    .neq('status', 'completed')
    .not('assignee_id', 'is', null)
    .in('due_date', targetDates);

  if (tasksError) {
    console.error('[cron/kakao-reminders] 태스크 조회 실패:', tasksError);
    return NextResponse.json(
      { sent: 0, skipped: 0, failed: 0, total: 0 },
      { status: 200 },
    );
  }

  const tasks = (tasksRaw ?? []) as unknown as TaskRow[];

  // ── 4. 담당자별로 묶기 (프로젝트별 하위 그룹) ────────────────────────────
  const byAssignee = new Map<string, Map<string, { title: string; due_date: string }[]>>();

  for (const task of tasks) {
    const projectName = getProjectName(task.projects);

    if (!byAssignee.has(task.assignee_id)) {
      byAssignee.set(task.assignee_id, new Map());
    }
    const projectMap = byAssignee.get(task.assignee_id)!;

    if (!projectMap.has(projectName)) {
      projectMap.set(projectName, []);
    }
    projectMap.get(projectName)!.push({ title: task.title, due_date: task.due_date });
  }

  // ── 5. 담당자별 발송 ──────────────────────────────────────────────────────
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  const total = byAssignee.size;

  for (const [assigneeId, tasksByProject] of byAssignee.entries()) {
    try {
      const tokenResult = await getValidKakaoAccessToken(assigneeId);

      if (!tokenResult.ok) {
        skipped++;
        continue;
      }

      const messageText = buildMessage(dateByOffset, tasksByProject);

      const templateObject = {
        object_type: 'text',
        text: messageText,
        link: {
          web_url: process.env.NEXT_PUBLIC_APP_URL,
          mobile_web_url: process.env.NEXT_PUBLIC_APP_URL,
        },
      };

      const kakaoRes = await sendKakaoMemo(tokenResult.accessToken, templateObject);

      if (!kakaoRes.ok) {
        failed++;
        console.error(
          '[cron/kakao-reminders] 카카오 발송 실패:',
          assigneeId,
          kakaoRes.status,
          await kakaoRes.text(),
        );
        continue;
      }

      sent++;
    } catch (error) {
      failed++;
      console.error('[cron/kakao-reminders] 발송 중 오류:', assigneeId, error);
    }
  }

  return NextResponse.json({ sent, skipped, failed, total }, { status: 200 });
}
