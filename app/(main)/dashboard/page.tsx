import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';
import type { ProjectStatus } from '@/types';

// ─── 상태 배지 ─────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ProjectStatus, string> = {
  setup: '설정중',
  selecting: '선택중',
  active: '진행중',
  completed: '완료',
};

const STATUS_COLORS: Record<ProjectStatus, string> = {
  setup: 'bg-gray-100 text-gray-500',
  selecting: 'bg-blue-100 text-blue-600',
  active: 'bg-green-100 text-green-700',
  completed: 'bg-purple-100 text-purple-700',
};

// ─── 프로젝트 카드 ─────────────────────────────────────────────────────────

interface ProjectCardProps {
  id: string;
  name: string;
  status: ProjectStatus;
  deadline?: string | null;
  description?: string | null;
}

function ProjectCard({ id, name, status, deadline, description }: ProjectCardProps) {
  return (
    <Link
      href={`/project/${id}`}
      className="group flex flex-col gap-2 rounded-xl border border-gray-100 bg-white px-5 py-4 shadow-sm transition hover:border-gray-300 hover:shadow-md"
    >
      {/* 상단: 이름 + 상태 배지 */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-semibold text-gray-900 group-hover:text-gray-700 truncate">
          {name}
        </span>
        <span
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLORS[status]}`}
        >
          {STATUS_LABELS[status]}
        </span>
      </div>

      {/* 설명 */}
      {description && (
        <p className="text-xs text-gray-400 leading-relaxed line-clamp-2">
          {description}
        </p>
      )}

      {/* 마감일 */}
      {deadline && (
        <p className="text-xs text-gray-400 mt-1">
          마감{' '}
          <span className="text-gray-500 font-medium">
            {new Date(deadline).toLocaleDateString('ko-KR', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </span>
        </p>
      )}
    </Link>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const userName =
    user?.user_metadata?.full_name ??
    user?.user_metadata?.name ??
    user?.email?.split('@')[0] ??
    '사용자';

  // RLS가 현재 유저의 프로젝트만 필터링
  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .order('created_at', { ascending: false });

  return (
    <div className="flex flex-col gap-10">
      {/* 인사말 */}
      <div>
        <p className="text-sm text-gray-400 mb-1">안녕하세요,</p>
        <h1 className="text-2xl font-semibold text-gray-900">{userName} 님</h1>
      </div>

      {/* 내 프로젝트 섹션 */}
      <section className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">내 프로젝트</h2>
          <Button asChild size="sm" variant="outline">
            <Link href="/project/new">+ 새 프로젝트</Link>
          </Button>
        </div>

        {!projects || projects.length === 0 ? (
          /* 빈 상태 UI */
          <div className="flex flex-col items-center justify-center gap-5 rounded-xl border border-dashed border-gray-200 bg-gray-50 py-16 text-center">
            <div className="flex flex-col items-center gap-2">
              <span className="text-3xl">📂</span>
              <p className="text-sm font-medium text-gray-700">
                아직 프로젝트가 없어요
              </p>
              <p className="text-xs text-gray-400">
                새 프로젝트를 만들어 팀원과 함께 시작해보세요.
              </p>
            </div>
            <Button asChild size="sm">
              <Link href="/project/new">새 프로젝트 만들기</Link>
            </Button>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((project) => (
              <li key={project.id}>
                <ProjectCard
                  id={project.id}
                  name={project.name ?? project.title ?? '(제목 없음)'}
                  status={project.status as ProjectStatus}
                  deadline={project.deadline}
                  description={project.description}
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
