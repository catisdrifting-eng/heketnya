// lib/ai/client.ts
// 통합 AI 클라이언트 — 환경변수로 provider 전환 + 메인 실패 시 자동 폴백.
// ⚠️ 서버 전용. route handler 안에서만 호출. 키는 절대 NEXT_PUBLIC_ 붙이지 말 것.

export type AIProvider = "gemini" | "groq" | "anthropic";

export interface CallAIOptions {
  system: string;          // 페르소나 / 시스템 지시
  user: string;            // 실제 사용자 프롬프트
  maxTokens?: number;      // 기본 4000
  provider?: AIProvider;   // 호출별 override (없으면 env 기본값)
  model?: string;          // 모델 override (없으면 provider 기본 모델)
}

const DEFAULTS = {
  primary: (process.env.AI_PROVIDER as AIProvider) || "gemini",
  fallback: (process.env.AI_FALLBACK_PROVIDER as AIProvider | undefined) || "groq",
  models: {
    gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    groq: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    anthropic: process.env.AI_MODEL || "claude-sonnet-4-6",
  },
};

type ProviderFn = (
  system: string,
  user: string,
  maxTokens: number,
  model: string,
) => Promise<string>;

// ─────────────────────────────────────────────
// Gemini (Google AI Studio, 네이티브 generateContent)
// ─────────────────────────────────────────────
const callGemini: ProviderFn = async (system, user, maxTokens, model) => {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 없음");

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": key },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        maxOutputTokens: maxTokens,
        temperature: 0.7,
        responseMimeType: "application/json", // JSON 강제 (마크다운 펜스 없이 순수 JSON 반환)
      },
    }),
  });

  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string =
    data?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? "").join("") ?? "";
  if (!text) throw new Error("Gemini 빈 응답 (안전필터/토큰초과 가능)");
  return text;
};

// ─────────────────────────────────────────────
// Groq (OpenAI 호환 /chat/completions)
// ⚠️ response_format json_object를 쓰려면 system/user에 "JSON" 단어가 있어야 함 (프롬프트에 이미 있음).
// ─────────────────────────────────────────────
const callGroq: ProviderFn = async (system, user, maxTokens, model) => {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY 없음");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.7,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: { type: "json_object" }, // JSON 강제
    }),
  });

  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq 빈 응답");
  return text;
};

// ─────────────────────────────────────────────
// 학교 게이트웨이 (Anthropic 네이티브 Messages, 공식 SDK) — 개발 전용, 크레딧 소모
// SDK는 anthropic provider를 실제로 쓸 때만 동적 import → Gemini로 돌릴 땐 로드 안 됨.
// ─────────────────────────────────────────────
const callAnthropic: ProviderFn = async (system, user, maxTokens, model) => {
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error("AI_API_KEY 없음");

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({
    baseURL: process.env.AI_API_BASE_URL,
    apiKey: key,
  });

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });

  const block = message.content[0];
  if (!block || block.type !== "text") throw new Error("학교 API: 예상치 못한 응답 타입");
  return block.text;
};

const DISPATCH: Record<AIProvider, ProviderFn> = {
  gemini: callGemini,
  groq: callGroq,
  anthropic: callAnthropic,
};

/**
 * 통합 호출. provider 미지정 시 env의 AI_PROVIDER 사용, 실패하면 AI_FALLBACK_PROVIDER로 1회 재시도.
 * 반환값은 순수 텍스트(보통 JSON 문자열) — 파싱은 호출하는 route에서.
 */
export async function callAI(opts: CallAIOptions): Promise<string> {
  const { system, user, maxTokens = 4000 } = opts;
  const primary = opts.provider ?? DEFAULTS.primary;
  const primaryModel = opts.model ?? DEFAULTS.models[primary];
  console.log(`[AI] provider=${primary} model=${primaryModel}`);

  try {
    return await DISPATCH[primary](system, user, maxTokens, primaryModel);
  } catch (err) {
    const fb = DEFAULTS.fallback;
    if (!fb || fb === primary) throw err;
    console.warn(`[AI] ${primary} 실패 → ${fb} 폴백:`, (err as Error).message);
    return await DISPATCH[fb](system, user, maxTokens, DEFAULTS.models[fb]);
  }
}
