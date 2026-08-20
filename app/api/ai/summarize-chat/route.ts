import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { callAI } from '@/lib/ai/client';

interface RequestBody {
  projectId: string;
}

interface AIResult {
  summary?: unknown;
  decisions?: unknown;
  todos?: unknown;
  open_questions?: unknown;
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
    .select('id, name, owner_id')
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

  // ── 5. 메시지 조회 (최근 100건, created_at 내림차순 → 오름차순으로 뒤집기) ─
  const { data: messagesRaw } = await supabase
    .from('messages')
    .select('id, content, user_id, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(100);

  const messages = (messagesRaw ?? []).slice().reverse();

  // ── 6. 메시지 3건 미만이면 AI 호출 없이 empty 반환 ────────────────────────
  if (messages.length < 3) {
    return NextResponse.json({ empty: true }, { status: 200 });
  }

  // ── 7. 보낸 사람 이름 조회 (project_members + users 조인) ─────────────────
  const senderIds = [
    ...new Set(messages.map((m) => m.user_id).filter(Boolean) as string[]),
  ];

  const nameMap: Record<string, string> = {};
  if (senderIds.length > 0) {
    const { data: usersRaw } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', senderIds);

    (usersRaw ?? []).forEach((u) => {
      nameMap[u.id] = u.name ?? u.email ?? '알 수 없음';
    });
  }

  // ── 8. AI 에 넘길 대화 목록 구성 (멘션 치환 포함) ──────────────────────────
  const chatLog = messages.map((m) => ({
    sender: m.user_id ? (nameMap[m.user_id] ?? '알 수 없음') : '알 수 없음',
    content: stripMentions(m.content ?? ''),
    createdAt: m.created_at,
  }));

  // ── 9. 프롬프트 생성 ──────────────────────────────────────────────────────
  const system = `당신은 팀 채팅 내용을 읽고 논의 흐름을 정리하는 프로젝트 코디네이터입니다.
반드시 유효한 JSON만 출력합니다. 마크다운, 코드블록, 설명 없이 JSON 객체만 반환합니다.

규칙:
- 대화에 실제로 나온 내용만 써라. 추측하거나 없는 내용을 지어내지 마라.
- decisions 는 팀이 합의에 이른 것만 넣어라. 제안 단계인 것은 open_questions 로 보내라.
- todos 는 누가 무엇을 하기로 했는지가 드러나게 써라. 대화에 담당자가 나오면 이름을 포함하라.
- 각 항목은 40자 이내로 짧게 써라.
- 특정 개인을 평가하거나 비교하지 마라. 누가 일을 안 했다는 식의 서술을 하지 마라.
- 해당 항목이 없으면 빈 배열로 두어라. 억지로 채우지 마라.
- 설명하지 말고 JSON 만 출력하라.`;

  const userPrompt = `프로젝트 이름: ${project.name}

# 채팅 로그 (오래된 순)
${JSON.stringify(chatLog, null, 2)}

# 출력 형식 (이 구조 그대로)
{
  "summary": "논의 흐름을 2~3문장으로",
  "decisions": ["정해진 것 한 줄", "..."],
  "todos": ["해야 할 일 한 줄", "..."],
  "open_questions": ["아직 안 정해진 것 한 줄", "..."]
}

JSON만 출력하세요.`;

  // ── 10. AI 호출 ───────────────────────────────────────────────────────────
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

  // ── 11. JSON 파싱 ─────────────────────────────────────────────────────────
  let parsed: AIResult;
  try {
    const cleaned = cleanJsonFence(rawText);
    parsed = JSON.parse(cleaned);
  } catch (e) {
    console.error('[파싱실패] 원본 응답:', rawText);
    console.error('[파싱실패] 에러:', e);
    return NextResponse.json({ error: 'ai_failed' }, { status: 500 });
  }

  // ── 12. 서버 검증 ─────────────────────────────────────────────────────────
  const summary = typeof parsed.summary === 'string' ? parsed.summary : '';
  const decisions = toStringArray(parsed.decisions, 10);
  const todos = toStringArray(parsed.todos, 10);
  const open_questions = toStringArray(parsed.open_questions, 10);

  return NextResponse.json(
    { summary, decisions, todos, open_questions, messageCount: messages.length },
    { status: 200 },
  );
}
