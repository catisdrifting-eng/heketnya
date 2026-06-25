import { NextResponse, type NextRequest } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@/lib/supabase/server';
import { generateRoadmapPrompt } from '@/lib/ai/prompts';
import type { ProjectType } from '@/types';

interface RequestBody {
  projectId: string;
  type: ProjectType;
  customType?: string;
  description: string;
  deadline: string;
  teamSize: number;
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

  const { projectId, type, customType, description, deadline, teamSize } = body;

  // ── 3. 프로젝트 조회 및 권한 확인 ────────────────────────────────────────
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
  if (project.status !== 'setup') {
    return NextResponse.json(
      { error: '이미 로드맵이 생성된 프로젝트입니다.' },
      { status: 400 },
    );
  }

  // ── 5. 프롬프트 생성 ──────────────────────────────────────────────────────
  const { system, user: userPrompt } = generateRoadmapPrompt({
    type,
    customType,
    description,
    deadline,
    teamSize,
  });

  // ── 6. Anthropic API 호출 ─────────────────────────────────────────────────
  let rawText: string;
  try {
    const anthropic = new Anthropic({
      baseURL: process.env.AI_API_BASE_URL,
      apiKey: process.env.AI_API_KEY,
    });

    const message = await anthropic.messages.create({
      model: process.env.AI_MODEL ?? 'claude-3-5-haiku-20241022',
      max_tokens: 2000,
      system,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const content = message.content[0];
    if (content.type !== 'text') {
      throw new Error('Unexpected response type from AI');
    }
    rawText = content.text;
  } catch {
    return NextResponse.json(
      { error: 'AI 호출에 실패했어요.' },
      { status: 500 },
    );
  }

  // ── 7. JSON 파싱 (코드펜스 제거 후) ──────────────────────────────────────
  try {
    // ```json ... ``` 또는 ``` ... ``` 코드펜스 제거
    const cleaned = rawText
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    const parsed = JSON.parse(cleaned) as { tasks: unknown[] };

    return NextResponse.json({ tasks: parsed.tasks }, { status: 200 });
  } catch {
    return NextResponse.json(
      { error: 'AI 응답 파싱에 실패했어요.' },
      { status: 500 },
    );
  }
}
