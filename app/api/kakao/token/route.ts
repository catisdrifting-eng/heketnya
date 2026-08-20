import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getValidKakaoAccessToken } from '@/lib/kakao/token';

export async function POST() {
  // ── 1. 세션 확인 ──────────────────────────────────────────────────────────
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });
  }

  // ── 2. 공통 함수로 유효한 액세스 토큰 확보 (필요 시 자동 갱신) ────────────
  const result = await getValidKakaoAccessToken(user.id);

  if (!result.ok) {
    if (result.reason === 'not_linked') {
      return NextResponse.json({ error: 'not_linked' }, { status: 404 });
    }

    return NextResponse.json({ error: 'reauth_required' }, { status: 401 });
  }

  return NextResponse.json({ access_token: result.accessToken }, { status: 200 });
}
