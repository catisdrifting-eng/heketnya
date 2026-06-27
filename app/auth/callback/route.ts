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
