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
  assignee_id: string | null;
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
    .select('id, name, description, deadline, owner_id, custom_roles')
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
    .select('id, title, description, due_date, status, suggested_role, sort_order, assignee_id')
    .eq('project_id', projectId)
    .is('deleted_at', null)
    .order('sort_order', { ascending: true });

  const tasks: TaskRow[] = tasksRaw ?? [];
  const taskMap: Record<string, TaskRow> = {};
  tasks.forEach((t) => {
    taskMap[t.id] = t;
  });

  // ── 5-1. 프로젝트 멤버 + 사용자 정보 조회 (담당자 이름 매핑용) ────────────
  const { data: membersRaw } = await supabase
    .from('project_members')
    .select('user_id, role_preference')
    .eq('project_id', projectId);

  const memberList = membersRaw ?? [];
  const memberUserIds = memberList.map((m) => m.user_id);

  const userNameMap: Record<string, string> = {};
  if (memberUserIds.length > 0) {
    const { data: usersRaw } = await supabase
      .from('users')
      .select('id, name')
      .in('id', memberUserIds);

    (usersRaw ?? []).forEach((u: { id: string; name: string | null }) => {
      userNameMap[u.id] = u.name ?? '이름없음';
    });
  }

  const requesterName = userNameMap[user.id] ?? user.email ?? '요청자';

  // ── 5-2. 태스크별 수정 가능 여부 계산 ─────────────────────────────────────
  // 요청자가 담당자이거나 / 요청자가 프로젝트 개설자이거나 / 담당자가 없으면 → 가능
  const editableMap: Record<string, boolean> = {};
  tasks.forEach((t) => {
    const editable = t.assignee_id === user.id || isOwner || !t.assignee_id;
    editableMap[t.id] = editable;
  });

  // ── 6. 오늘 날짜 (한국 시간 기준) ─────────────────────────────────────────
  const today = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

  // ── 6-1. 프로젝트에 정의된 역할 목록 (projects.custom_roles 만 사용) ──────
  const customRolesRaw = Array.isArray(project.custom_roles) ? project.custom_roles : [];
  const customRoles: { id: string; label: string }[] = customRolesRaw
    .filter(
      (r: unknown): r is { id: string; label: string } =>
        !!r &&
        typeof r === 'object' &&
        typeof (r as { id?: unknown }).id === 'string' &&
        typeof (r as { label?: unknown }).label === 'string',
    )
    .map((r) => ({ id: r.id, label: r.label }));
  const validRoleIds = new Set(customRoles.map((r) => r.id));


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
- '내 태스크', '내가 맡은 것' 같은 표현은 요청자가 담당자인 태스크를 뜻한다.
- '미지정', '아무도 안 맡은 것' 은 담당자가 없는 태스크를 뜻한다.
- editable 이 false 인 태스크는 맥락 참고용이다. 그 태스크에 대해 update 나 delete 를 제안하지 마라. 요청이 전체를 대상으로 하더라도 editable 이 true 인 것만 제안하라.
${
  customRoles.length > 0
    ? `- 사용할 수 있는 역할: ${customRoles.map((r) => `${r.id}(${r.label})`).join(', ')}
- suggested_role 에는 위 목록의 id 값만 써라. 괄호 안의 한글은 설명이니 그대로 쓰지 마라.
- 적절한 역할이 목록에 없으면 반드시 null 로 두어라. 새 id 를 지어내지 마라.`
    : `- 이 프로젝트에는 정의된 역할이 없다. suggested_role 은 항상 null 로 두어라.`
}

- 오늘은 ${today}이다. '오늘', '내일', '이번 주', '일주일 뒤', '다음 주 월요일' 같은 표현은 모두 이 날짜를 기준으로 계산해서 YYYY-MM-DD 형식으로 변환하라.
- 마감일을 정할 수 없으면 null 로 두어라. 추측해서 아무 날짜나 넣지 마라.
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
    assignee_name: t.assignee_id ? (userNameMap[t.assignee_id] ?? '이름없음') : '미지정',
    editable: editableMap[t.id],
  }));

  const userPrompt = `이 요청을 한 사람은 ${requesterName}(id: ${user.id})입니다.

오늘 날짜: ${today}

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
      // 권한 밖 태스크는 조용히 제외한다 (droppedCount 에 넣지 않음)
      if (!editableMap[p.task_id]) {
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
