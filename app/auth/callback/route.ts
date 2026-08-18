import { NextResponse, type NextRequest } from 'next/server';
import { cookies } from 'next/headers';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const user = data.user;

      // ── 카카오 로그인인 경우 provider_token을 kakao_tokens 테이블에 저장 ──────
      // provider_token은 로그인 직후 세션에만 존재하고 이후 사라지므로,
      // 알림 발송 시 재사용할 수 있도록 DB에 별도 보관한다.
      const provider = user.app_metadata?.provider;
      const session = data.session;

      if (provider === 'kakao' && session?.provider_token) {
        const expiresAt = new Date(Date.now() + 6 * 60 * 60 * 1000); // 대략 6시간 후

        await supabase.from('kakao_tokens').upsert({
          user_id: user.id,
          access_token: session.provider_token,
          refresh_token: session.provider_refresh_token ?? null,
          expires_at: expiresAt.toISOString(),
          updated_at: new Date().toISOString(),
        });
      }

      // ── invite_token 쿠키 처리 ──────────────────────────────────────────
      const cookieStore = await cookies();
      const inviteToken = cookieStore.get('invite_token')?.value;

      if (inviteToken) {
        // invite_token으로 project 조회
        const { data: project } = await supabase
          .from('projects')
          .select('id')
          .eq('invite_token', inviteToken)
          .eq('invite_active', true)
          .single();

        if (project) {
          // 이미 멤버인지 확인 (중복 방지)
          const { data: existing } = await supabase
            .from('project_members')
            .select('id')
            .eq('project_id', project.id)
            .eq('user_id', user.id)
            .single();

          if (!existing) {
            // project_members INSERT
            await supabase.from('project_members').insert({
              project_id: project.id,
              user_id: user.id,
            });
          }

          // invite_token 쿠키 삭제 후 role 페이지로 redirect
          const redirectResponse = NextResponse.redirect(
            `${appUrl}/project/${project.id}/role`,
          );
          redirectResponse.cookies.set('invite_token', '', {
            maxAge: 0,
            path: '/',
          });
          return redirectResponse;
        }
      }

      // invite_token 없으면 /dashboard로 이동
      return NextResponse.redirect(`${appUrl}/dashboard`);
    }
  }

  // 실패 시 /login?error=auth_failed 로 redirect
  return NextResponse.redirect(`${appUrl}/login?error=auth_failed`);
}
