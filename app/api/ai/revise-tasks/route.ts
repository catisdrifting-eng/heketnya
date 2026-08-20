import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callAI } from '@/lib/ai/client';

interface RequestBody {
  projectId: string;
  instruction: string;
}

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  status: string;
  suggested_role: string | null;
  sort_order: number | null;
}

type ProposalOp = 'add' | 'update' | 'delete';

interface RawProposal {
  op?: string;
  task_id?: string;
  title?: string;
  description?: string | null;
  due_date?: string | null;
  suggested_role?: string | null;
  reason?: string;
}

interface CleanedProposal {
  op: ProposalOp;
  task_id?: string;
  title?: string;
  description?: string | null;
  due_date?: string | null;
  suggested_role?: string | null;
  reason?: string;
  currentTitle?: string;
}

function cleanJsonFence(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const { projectId, instruction } = body;

  if (!projectId) {
    return NextResponse.json({ error: '프로젝트 ID가 필요합니다.' }, { status: 400 });
  }

  if (!instruction || typeof instruction !== 'string' || instruction.trim().length === 0) {
    return NextResponse.json({ error: '지시 내용이 필요합니다.' }, { status: 400 });
  }

  if (instruction.length > 500) {
    return NextResponse.json({ error: '지시 내용은 500자를 넘을 수 없습니다.' }, { status: 400 });
  }

  // ── 3. 프로젝트 조회 ──────────────────────────────────────────────────────
  const { data: project, error: projectError } = await supabase
    .from('projects')
    .select('id, name, description, deadline, owner_id')
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

  // ── 5. 태스크 목록 조회 ───────────────────────────────────────────────────
  const { data: tasksRaw } = await supabase
    .from('tasks')
    .select('id, title, description, due_date, status, suggested_role, sort_order')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  const tasks: TaskRow[] = tasksRaw ?? [];
  const taskMap: Record<string, TaskRow> = {};
  tasks.forEach((t) => {
    taskMap[t.id] = t;
  });

  // ── 6. 오늘 날짜 (한국 시간 기준) ─────────────────────────────────────────
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ── 7. 프롬프트 생성 ──────────────────────────────────────────────────────
  const system = `너는 프로젝트 관리 도우미다. 사용자의 자연어 지시를 바탕으로 태스크 변경 제안을 JSON으로만 출력한다.
반드시 아래 JSON 스키마를 그대로 따라라. 설명하지 말고 JSON만 출력하라.

{
  "summary": "무엇을 왜 바꾸는지 한두 문장",
  "proposals": [
    { "op": "add",    "title": "제목", "description": "설명 또는 null", "due_date": "YYYY-MM-DD 또는 null", "suggested_role": "역할 또는 null", "reason": "한 줄 이유" },
    { "op": "update", "task_id": "기존 태스크 id", "title": "바뀐 제목", "description": "바뀐 설명 또는 null", "due_date": "YYYY-MM-DD 또는 null", "reason": "한 줄 이유" },
    { "op": "delete", "task_id": "기존 태스크 id", "reason": "한 줄 이유" }
  ]
}

규칙:
- op 은 add, update, delete 셋뿐이다. 다른 값을 쓰지 마라.
- update 는 바꾸지 않는 필드도 현재 값을 그대로 채워서 title, description, due_date 세 필드를 모두 반환하라.
- task_id 는 반드시 아래 제시된 태스크 목록에 있는 id 여야 한다. 새로 지어내지 마라.
- 담당자는 절대 바꾸지 마라. assignee 관련 필드를 응답에 넣지 마라.
- 상태(status)도 바꾸지 마라.
- 지시와 무관한 태스크는 건드리지 마라. 바꿀 필요가 없으면 proposals 를 빈 배열로 두어라.
- 제안은 최대 20개까지만 하라.
- reason 은 40자 이내로 짧게 써라.
- 설명하지 말고 JSON 만 출력하라.`;

  const projectInfo = {
    name: project.name,
    description: project.description ?? null,
    deadline: project.deadline ?? null,
  };

  const taskList = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    description: t.description ?? null,
    due_date: t.due_date ?? null,
    status: t.status,
    suggested_role: t.suggested_role ?? null,
    sort_order: t.sort_order ?? null,
  }));

  const userPrompt = `오늘 날짜: ${today}

프로젝트 정보:
${JSON.stringify(projectInfo, null, 2)}

현재 태스크 목록:
${JSON.stringify(taskList, null, 2)}

사용자 지시:
${instruction}`;

  // ── 8. AI 호출 ────────────────────────────────────────────────────────────
  let rawText: string;
  try {
    rawText = await callAI({
      system,
      user: userPrompt,
      maxTokens: 3000,
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

  // ── 9. JSON 파싱 ──────────────────────────────────────────────────────────
  let parsed: { summary?: string; proposals?: RawProposal[] };
  try {
    const cleaned = cleanJsonFence(rawText);
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[파싱실패] 원본 응답:', rawText);
    console.error('[파싱실패] 에러:', e);
    return NextResponse.json({ error: 'ai_failed' }, { status: 500 });
  }

  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const rawProposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];

  // ── 10. 서버 검증 ─────────────────────────────────────────────────────────
  let droppedCount = 0;
  const validProposals: CleanedProposal[] = [];

  for (const p of rawProposals) {
    if (p.op !== 'add' && p.op !== 'update' && p.op !== 'delete') {
      droppedCount++;
      continue;
    }

    if (p.op === 'update' || p.op === 'delete') {
      if (!p.task_id || !taskMap[p.task_id]) {
        droppedCount++;
        continue;
      }
    }

    if (p.op === 'add' || p.op === 'update') {
      if (!p.title || typeof p.title !== 'string' || p.title.trim().length === 0) {
        droppedCount++;
        continue;
      }
    }

    if (p.due_date !== undefined && p.due_date !== null && !DATE_RE.test(p.due_date)) {
      droppedCount++;
      continue;
    }

    const cleaned: CleanedProposal = { op: p.op };

    if (p.op === 'add') {
      cleaned.title = p.title;
      cleaned.description = p.description ?? null;
      cleaned.due_date = p.due_date ?? null;
      cleaned.suggested_role = p.suggested_role ?? null;
      cleaned.reason = p.reason ?? '';
    } else if (p.op === 'update') {
      cleaned.task_id = p.task_id;
      cleaned.title = p.title;
      cleaned.description = p.description ?? null;
      cleaned.due_date = p.due_date ?? null;
      cleaned.reason = p.reason ?? '';
      cleaned.currentTitle = taskMap[p.task_id!].title;
    } else {
      cleaned.task_id = p.task_id;
      cleaned.reason = p.reason ?? '';
      cleaned.currentTitle = taskMap[p.task_id!].title;
    }

    validProposals.push(cleaned);
  }

  const droppedByLimit = Math.max(0, validProposals.length - 20);
  const proposals = validProposals.slice(0, 20);
  droppedCount += droppedByLimit;

  return NextResponse.json({ summary, proposals, droppedCount }, { status: 200 });
}
