import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import { CopyInviteLink } from '@/components/copy-invite-link';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function InvitePage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: project } = await supabase
    .from('projects')
    .select('id, name, invite_token')
    .eq('id', id)
    .single();

  if (!project || !project.invite_token) {
    notFound();
  }

  const inviteLink = `${process.env.NEXT_PUBLIC_APP_URL}/join/${project.invite_token}`;

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh]">
      <div className="w-full max-w-md flex flex-col gap-8">
        {/* 헤더 */}
        <div className="flex flex-col items-center gap-2 text-center">
          <span className="text-3xl">🎉</span>
          <h1 className="text-2xl font-semibold text-gray-900">팀원을 초대하세요</h1>
          <p className="text-sm text-gray-400">
            아래 링크를 팀원에게 공유하면 프로젝트에 참여할 수 있어요.
          </p>
        </div>

        {/* 프로젝트 이름 */}
        <div className="rounded-xl border border-gray-100 bg-gray-50 px-5 py-4 text-center">
          <p className="text-xs text-gray-400 mb-1">프로젝트</p>
          <p className="text-base font-semibold text-gray-900">{project.name}</p>
        </div>

        {/* 초대 링크 복사 */}
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-gray-600">초대 링크</p>
          <CopyInviteLink inviteLink={inviteLink} />
        </div>

        {/* 이동 버튼 */}
        <div className="flex flex-col gap-2">
          <Button asChild size="lg" className="w-full">
            <Link href={`/project/${id}`}>프로젝트 홈으로</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href={`/project/${id}/select`}>내 태스크 선택하기 →</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="w-full">
            <Link href="/dashboard">대시보드로 이동</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
