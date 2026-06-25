import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';

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

  // TODO: 실제 프로젝트 목록은 DB에서 조회
  const projects: unknown[] = [];

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

        {projects.length === 0 ? (
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
            {/* 프로젝트 카드 목록 — 추후 구현 */}
          </ul>
        )}
      </section>
    </div>
  );
}
