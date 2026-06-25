import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import type { ProjectStatus } from '@/types';

interface Props {
  params: Promise<{ id: string }>;
}

// ─── 상태 배지 ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ProjectStatus, string> = {
  setup: '설정 중',
  selecting: '태스크 선택 중',
  active: '진행 중',
  completed: '완료',
};

const STATUS_COLORS: Record<ProjectStatus, string> = {
  setup: 'bg-gray-100 text-gray-600',
  selecting: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-purple-100 text-purple-700',
};

// ─── 상태별 안내 배너 ──────────────────────────────────────────────────────

function StatusBanner({ status, projectId }: { status: ProjectStatus; projectId: string }) {
  if (status === 'setup') {
    return (
      <div className="flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
        <div>
          <p className="text-sm font-medium text-amber-800">로드맵을 먼저 생성해주세요</p>
          <p className="text-xs text-amber-600 mt-0.5">AI가 프로젝트 설명을 분석해 태스크를 만들어드려요.</p>
        </div>
        <Button asChild size="sm" className="shrink-0">
          <Link href={`/project/${projectId}/roadmap`}>로드맵 생성</Link>
        </Button>
      </div>
    );
  }

  if (status === 'selecting') {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4">
        <p className="text-sm font-medium text-blue-800">팀원들이 태스크를 선택 중이에요</p>
        <p className="text-xs text-blue-600 mt-0.5">모든 팀원이 역할을 선택하면 프로젝트가 시작됩니다.</p>
      </div>
    );
  }

  if (status === 'active') {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50 px-5 py-4">
        <p className="text-sm font-medium text-green-800">프로젝트 진행 중</p>
        <p className="text-xs text-green-600 mt-0.5">팀원들과 함께 태스크를 완료해나가세요.</p>
      </div>
    );
  }

  if (status === 'completed') {
    return (
      <div className="rounded-xl border border-purple-200 bg-purple-50 px-5 py-4">
        <p className="text-sm font-medium text-purple-800">🎉 프로젝트 완료</p>
        <p className="text-xs text-purple-600 mt-0.5">수고하셨습니다! 모든 태스크가 완료되었어요.</p>
      </div>
    );
  }

  return null;
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default async function ProjectPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  // 프로젝트 조회
  const { data: project } = await supabase
    .from('projects')
    .select('id, name, status, deadline, description, type')
    .eq('id', id)
    .single();

  if (!project) {
    notFound();
  }

  // 팀원 목록 조회 (users 조인)
  const { data: members } = await supabase
    .from('project_members')
    .select('*, user:users(name, email, avatar_url)')
    .eq('project_id', id);

  const status = project.status as ProjectStatus;

  return (
    <div className="flex flex-col gap-8">
      {/* 프로젝트 헤더 */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">{project.name}</h1>
          <span
            className={`text-xs font-medium rounded-full px-2.5 py-1 ${STATUS_COLORS[status]}`}
          >
            {STATUS_LABELS[status]}
          </span>
        </div>

        {project.deadline && (
          <p className="text-sm text-gray-400">
            마감일:{' '}
            <span className="text-gray-600">
              {new Date(project.deadline).toLocaleDateString('ko-KR', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </span>
          </p>
        )}

        {project.description && (
          <p className="text-sm text-gray-500 leading-relaxed mt-1 whitespace-pre-line line-clamp-3">
            {project.description}
          </p>
        )}
      </div>

      {/* 상태별 안내 배너 */}
      <StatusBanner status={status} projectId={id} />

      {/* 팀원 목록 */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">팀원</h2>
          <Button asChild size="sm" variant="outline">
            <Link href={`/project/${id}/invite`}>+ 초대</Link>
          </Button>
        </div>

        {!members || members.length === 0 ? (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-8 text-center">
            <p className="text-sm text-gray-400">아직 팀원이 없어요.</p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {members.map((member) => {
              const user = Array.isArray(member.user) ? member.user[0] : member.user;
              return (
                <li
                  key={member.id}
                  className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3"
                >
                  {/* 아바타 */}
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-200 text-xs font-semibold text-gray-600">
                    {user?.name?.[0]?.toUpperCase() ?? user?.email?.[0]?.toUpperCase() ?? '?'}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {user?.name ?? user?.email ?? '알 수 없음'}
                    </span>
                    {member.role && (
                      <span className="text-xs text-gray-400">{member.role}</span>
                    )}
                  </div>

                  <span className="ml-auto text-xs text-gray-300">
                    {new Date(member.joined_at).toLocaleDateString('ko-KR')}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
