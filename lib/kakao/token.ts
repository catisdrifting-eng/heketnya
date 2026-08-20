import { createAdminClient } from '@/lib/supabase/admin';

interface KakaoTokenRow {
  access_token: string;
  refresh_token: string | null;
  expires_at: string;
}

const KAKAO_TOKEN_URL = 'https://kauth.kakao.com/oauth/token';

// 만료까지 이 시간(ms) 미만으로 남았으면 만료로 간주하고 갱신한다.
const EXPIRY_MARGIN_MS = 5 * 60 * 1000; // 5분

type GetValidKakaoAccessTokenResult =
  | { ok: true; accessToken: string }
  | { ok: false; reason: 'not_linked' | 'reauth_required' };

// ── 카카오 액세스 토큰 갱신 (kauth.kakao.com) ────────────────────────────
async function refreshKakaoToken(refreshToken: string) {
  const restApiKey = process.env.KAKAO_REST_API_KEY;
  const clientSecret = process.env.KAKAO_CLIENT_SECRET;

  if (!restApiKey) {
    return { ok: false as const };
  }

  const res = await fetch(KAKAO_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: restApiKey,
      ...(clientSecret ? { client_secret: clientSecret } : {}),
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    return { ok: false as const };
  }

  const data = (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
  };

  return { ok: true as const, data };
}

// ── 유효한 카카오 액세스 토큰을 반환 (필요 시 자동 갱신) ─────────────────
export async function getValidKakaoAccessToken(
  userId: string,
): Promise<GetValidKakaoAccessTokenResult> {
  const supabase = createAdminClient();

  const { data: tokenRow } = await supabase
    .from('kakao_tokens')
    .select('access_token, refresh_token, expires_at')
    .eq('user_id', userId)
    .single();

  const kakaoToken = tokenRow as KakaoTokenRow | null;

  if (!kakaoToken) {
    return { ok: false, reason: 'not_linked' };
  }

  const expiresAt = new Date(kakaoToken.expires_at).getTime();
  const now = Date.now();

  if (expiresAt - now >= EXPIRY_MARGIN_MS) {
    return { ok: true, accessToken: kakaoToken.access_token };
  }

  if (!kakaoToken.refresh_token) {
    console.error('[kakao/token] refresh_token 없음, 재로그인 필요:', userId);
    return { ok: false, reason: 'reauth_required' };
  }

  const refreshed = await refreshKakaoToken(kakaoToken.refresh_token);

  if (!refreshed.ok) {
    console.error('[kakao/token] 토큰 갱신 실패:', userId);
    return { ok: false, reason: 'reauth_required' };
  }

  const newExpiresAt = new Date(Date.now() + refreshed.data.expires_in * 1000);

  await supabase.from('kakao_tokens').upsert({
    user_id: userId,
    access_token: refreshed.data.access_token,
    refresh_token: refreshed.data.refresh_token ?? kakaoToken.refresh_token,
    expires_at: newExpiresAt.toISOString(),
    updated_at: new Date().toISOString(),
  });

  return { ok: true, accessToken: refreshed.data.access_token };
}
