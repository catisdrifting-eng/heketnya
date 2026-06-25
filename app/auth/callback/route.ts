import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error && data.user) {
      const user = data.user;

      // ── invite_token 쿠키 처리 ──────────────────────────────────────────
      const inviteToken = request.cookies.get('invite_token')?.value;

      if (inviteToken) {
        // invite_token으로 project_id 찾기
        const { data: project } = await supabase
          .from('projects')
          .select('id')
          .eq('invite_token', inviteToken)
          .eq('invite_active', true)
          .single();

        if (project) {
          // 이미 멤버인지 확인
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

          // 쿠키 삭제 후 role 페이지로 redirect
          const redirectResponse = NextResponse.redirect(
            `${origin}/project/${project.id}/role`,
          );
          redirectResponse.cookies.delete('invite_token');
          return redirectResponse;
        }
      }

      // invite_token 없으면 기존대로 /dashboard로 이동
      return NextResponse.redirect(`${origin}/dashboard`);
    }
  }

  // 실패 시 /login?error=auth_failed 로 redirect
  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
