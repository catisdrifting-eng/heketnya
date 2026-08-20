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
  retries?: number;                       // 기본 2 (시도당 재시도 횟수, 최초 시도 제외)
  validate?: (text: string) => boolean;   // 기본 없음
  timeoutMs?: number;                     // 기본 60000
}

const DEFAULTS = {
  primary: (process.env.AI_PROVIDER as AIProvider) || "gemini",
  fallback: (process.env.AI_FALLBACK_PROVIDER as AIProvider | undefined) || "groq",
  models: {
    gemini: process.env.GEMINI_MODEL || "gemini-2.5-flash",
    groq: process.env.GROQ_MODEL ?? "openai/gpt-oss-120b",
    anthropic: process.env.AI_MODEL || "claude-sonnet-4-6",
  },
};

// HTTP 상태 코드를 담을 수 있는 provider 전용 에러.
// status가 없으면 네트워크 오류/abort 등 HTTP 응답 자체가 없었던 경우.
class AIProviderError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "AIProviderError";
    this.status = status;
  }
}

// setTimeout을 Promise로 감싼 sleep 헬퍼.
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 로그용 사유 문자열을 200자로 자르고 넘치면 '…' 을 붙인다.
function truncateReason(reason: string): string {
  if (reason.length <= 200) return reason;
  return `${reason.slice(0, 200)}…`;
}


type ProviderFn = (
  system: string,
  user: string,
  maxTokens: number,
  model: string,
  signal?: AbortSignal,
) => Promise<string>;

// ─────────────────────────────────────────────
// Gemini (Google AI Studio, 네이티브 generateContent)
// ─────────────────────────────────────────────
const callGemini: ProviderFn = async (system, user, maxTokens, model, signal) => {
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
    signal,
  });

  if (!res.ok) throw new AIProviderError(`Gemini ${res.status}: ${await res.text()}`, res.status);
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
const callGroq: ProviderFn = async (system, user, maxTokens, model, signal) => {
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
    signal,
  });

  if (!res.ok) throw new AIProviderError(`Groq ${res.status}: ${await res.text()}`, res.status);
  const data = await res.json();
  const text: string = data?.choices?.[0]?.message?.content ?? "";
  if (!text) throw new Error("Groq 빈 응답");
  return text;
};

// ─────────────────────────────────────────────
// 학교 게이트웨이 (Anthropic 네이티브 Messages, 공식 SDK) — 개발 전용, 크레딧 소모
// SDK는 anthropic provider를 실제로 쓸 때만 동적 import → Gemini로 돌릴 땐 로드 안 됨.
// ─────────────────────────────────────────────
const callAnthropic: ProviderFn = async (system, user, maxTokens, model, signal) => {
  const key = process.env.AI_API_KEY;
  if (!key) throw new Error("AI_API_KEY 없음");

  const Anthropic = (await import("@anthropic-ai/sdk")).default;
  const client = new Anthropic({
    baseURL: process.env.AI_API_BASE_URL,
    apiKey: key,
  });

  let message;
  try {
    message = await client.messages.create(
      {
        model,
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      },
      { signal },
    );
  } catch (err) {
    const status = (err as { status?: number })?.status;
    if (typeof status === "number") {
      throw new AIProviderError((err as Error).message, status);
    }
    throw err;
  }

  const block = message.content[0];
  if (!block || block.type !== "text") throw new Error("학교 API: 예상치 못한 응답 타입");
  return block.text;
};

const DISPATCH: Record<AIProvider, ProviderFn> = {
  gemini: callGemini,
  groq: callGroq,
  anthropic: callAnthropic,
};

// 재시도 지연(ms): 1회차 실패 후 1초, 2회차 실패 후 2초.
const RETRY_DELAYS_MS = [1000, 2000];

/**
 * 하나의 provider에 대해 재시도·타임아웃을 적용하며 호출한다.
 * 메인/폴백 모두 이 함수를 통해서만 호출되어 재시도 로직이 중복되지 않는다.
 */
async function callWithRetry(
  provider: AIProvider,
  system: string,
  user: string,
  maxTokens: number,
  model: string,
  retries: number,
  timeoutMs: number,
  validate?: (text: string) => boolean,
): Promise<string> {
  const totalAttempts = retries + 1;
  let lastReason = "알 수 없는 오류";

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const text = await DISPATCH[provider](system, user, maxTokens, model, controller.signal);

      if (!text || !text.trim()) {
        lastReason = "응답 본문이 비어있음";
        console.error(
          `[callAI] provider=${provider} attempt=${attempt}/${totalAttempts} reason=${lastReason}`,
        );
        if (attempt < totalAttempts) {
          await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
          continue;
        }
        throw new Error(`[callAI] ${provider} 최종 실패: ${lastReason}`);
      }

      if (validate && !validate(text)) {
        lastReason = "validate 검증 실패";
        console.error(
          `[callAI] provider=${provider} attempt=${attempt}/${totalAttempts} reason=${lastReason}`,
        );
        if (attempt < totalAttempts) {
          await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
          continue;
        }
        throw new Error(`[callAI] ${provider} 최종 실패: ${lastReason}`);
      }

      return text;
    } catch (err) {
      // 위에서 명시적으로 던진 최종 실패 Error는 그대로 위로 전파.
      if (err instanceof Error && err.message.startsWith("[callAI]")) {
        throw err;
      }

      const status = err instanceof AIProviderError ? err.status : undefined;
      const isAbort = err instanceof Error && err.name === "AbortError";
      lastReason = isAbort
        ? `타임아웃(${timeoutMs}ms) 초과`
        : (err as Error)?.message ?? String(err);

      // 재시도하지 않는 경우: HTTP 4xx (429는 재시도해도 소용없으므로 즉시 실패).
      const noRetry = typeof status === "number" && status >= 400 && status < 500;

      console.error(
        `[callAI] provider=${provider} attempt=${attempt}/${totalAttempts} reason=${truncateReason(lastReason)}`,
      );

      if (noRetry || attempt >= totalAttempts) {
        const finalErr = new Error(`[callAI] ${provider} 최종 실패: ${lastReason}`);
        if (typeof status === "number") (finalErr as { status?: number }).status = status;
        throw finalErr;
      }


      await sleep(RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]);
    } finally {
      clearTimeout(timer);
    }
  }

  // 이론상 도달하지 않지만 타입 안전을 위해.
  throw new Error(`[callAI] ${provider} 최종 실패: ${lastReason}`);
}

// provider가 실제로 호출 가능한지(필요한 env가 채워져 있는지) 확인.
// 비어있으면 폴백 체인에서 그 단계를 건너뛴다.
function isProviderConfigured(provider: AIProvider): boolean {
  if (provider === "gemini") return !!process.env.GEMINI_API_KEY;
  if (provider === "groq") return !!process.env.GROQ_API_KEY;
  if (provider === "anthropic") return !!process.env.AI_API_KEY && !!process.env.AI_API_BASE_URL;
  return false;
}

/**
 * 통합 호출. provider 미지정 시 env의 AI_PROVIDER 사용, 실패하면
 * gemini → groq → anthropic(학교 API) 순으로 폴백한다 (primary는 그대로 우선 시도).
 * 반환값은 순수 텍스트(보통 JSON 문자열) — 파싱은 호출하는 route에서.
 * options 없이 호출하면 재시도(기본 2회)와 타임아웃(기본 60000ms)만 적용되고 기존 동작·반환값은 동일하다.
 */
export async function callAI(opts: CallAIOptions): Promise<string> {
  const { system, user, maxTokens = 4000 } = opts;
  const retries = opts.retries ?? 2;
  const timeoutMs = opts.timeoutMs ?? 60000;
  const validate = opts.validate;

  const primary = opts.provider ?? DEFAULTS.primary;

  // 폴백 체인: primary 먼저, 그 다음 gemini → groq → anthropic(학교 API) 순서로
  // (primary와 중복되거나 env 미설정인 provider는 건너뜀).
  const chainOrder: AIProvider[] = ["gemini", "groq", "anthropic"];
  const chain = [primary, ...chainOrder.filter((p) => p !== primary)];

  const attempted: { provider: AIProvider; reason: string }[] = [];

  for (let i = 0; i < chain.length; i++) {
    const provider = chain[i];

    if (!isProviderConfigured(provider)) {
      attempted.push({ provider, reason: "미설정(env 없음)" });
      continue;
    }

    const model = provider === primary ? opts.model ?? DEFAULTS.models[provider] : DEFAULTS.models[provider];
    console.log(`[AI] provider=${provider} model=${model}`);

    try {
      return await callWithRetry(provider, system, user, maxTokens, model, retries, timeoutMs, validate);
    } catch (err) {
      const status = (err as { status?: number })?.status;
      const reason = status ? String(status) : (err as Error)?.message ?? String(err);
      attempted.push({ provider, reason });
      if (i < chain.length - 1) {
        console.warn(`[AI] ${provider} 실패 → 다음 폴백으로:`, truncateReason(reason));
      }
    }
  }

  const summary = attempted.map((a) => `${a.provider}(${a.reason})`).join(", ");
  console.error(`[callAI] 전체 실패: ${summary}`);
  throw new Error(`[callAI] 전체 실패: ${summary}`);
}

