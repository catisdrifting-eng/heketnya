import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { Button } from '@/components/ui/button';

export default async function LandingPage() {
  // 로그인된 유저는 대시보드로
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) {
    redirect('/dashboard');
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 상단 네비 */}
      <header className="flex items-center justify-between px-8 py-5 border-b border-gray-100">
        <span className="text-sm font-semibold tracking-tight text-gray-900">HEKETNYA</span>
        <Button asChild size="sm" variant="outline">
          <Link href="/login">로그인</Link>
        </Button>
      </header>

      {/* Hero */}
      <main className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex flex-col items-center gap-6 max-w-lg">
          <h1 className="text-4xl font-semibold tracking-tight text-gray-900 leading-tight">
            팀 프로젝트,<br />조금 더 편하게.
          </h1>
          <p className="text-base text-gray-400 leading-relaxed">
            HEKETNYA는 팀 프로젝트 협업 도구예요.
          </p>
          <Button asChild size="lg" className="px-8">
            <Link href="/login">시작하기</Link>
          </Button>
        </div>

        {/* 기능 소개 */}
        <div className="mt-20 grid grid-cols-1 gap-4 sm:grid-cols-3 max-w-2xl w-full text-left">
          {[
            {
              icon: '📋',
              text: '할 일 목록을 자동으로 만들어줘요.',
            },
            {
              icon: '🙋',
              text: '팀원들이 직접 역할을 나눠 가져요.',
            },
            {
              icon: '📊',
              text: '진행 상황을 한눈에 볼 수 있어요.',
            },
          ].map(({ icon, text }) => (
            <div
              key={text}
              className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50 px-5 py-4"
            >
              <span className="text-xl">{icon}</span>
              <p className="text-sm text-gray-600 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </main>

      {/* 푸터 */}
      <footer className="py-6 text-center">
        <p className="text-xs text-gray-300">© 2026 HEKETNYA</p>
      </footer>
    </div>
  );
}
