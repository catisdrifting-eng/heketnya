import { createAdminClient } from '@/lib/supabase/admin';
import JoinActions from '@/components/join-actions';

interface Props {
  params: Promise<{ token: string }>;
}

export default async function JoinPage({ params }: Props) {
  const { token } = await params;

  // 서버에서 admin 클라이언트로 프로젝트 조회 (RLS 우회)
  const admin = createAdminClient();
  const { data: project } = await admin
    .from('projects')
    .select('id, name, deadline, team_size')
    .eq('invite_token', token)
    .eq('invite_active', true)
    .single();

  if (!project) {
    return (
      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        <span className="text-4xl">🔗</span>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">유효하지 않은 초대 링크입니다</h1>
          <p className="mt-2 text-sm text-gray-400">
            링크가 만료되었거나 잘못된 링크예요.
          </p>
        </div>
        <a
          href="/"
          className="inline-flex items-center rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          홈으로 이동
        </a>
      </div>
    );
  }

  return (
    <JoinActions
      token={token}
      project={{
        id: project.id,
        name: project.name,
        deadline: project.deadline,
        team_size: project.team_size,
      }}
    />
  );
}
