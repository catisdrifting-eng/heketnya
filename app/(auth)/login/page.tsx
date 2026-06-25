'use client';

import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

export default function LoginPage() {
  async function handleGoogleLogin() {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      },
    });
  }

  return (
    <div className="w-full max-w-sm flex flex-col items-center gap-10">
      {/* 로고 */}
      <div className="flex flex-col items-center gap-3">
        <span className="text-3xl font-bold tracking-tight text-gray-900">
          HEKETNYA
        </span>
        <p className="text-sm text-gray-500 text-center leading-relaxed">
          AI가 팀 프로젝트를 관리해드려요
        </p>
      </div>

      {/* 로그인 카드 */}
      <div className="w-full flex flex-col gap-4 rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
        <p className="text-center text-sm text-gray-400 mb-2">
          계속하려면 로그인하세요
        </p>

        <Button
          variant="outline"
          size="lg"
          className="w-full gap-3 h-11 text-sm font-medium text-gray-700 border-gray-300 hover:bg-gray-50"
          onClick={handleGoogleLogin}
        >
          {/* Google 아이콘 */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 24 24"
            className="size-4"
            aria-hidden="true"
          >
            <path
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              fill="#4285F4"
            />
            <path
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              fill="#34A853"
            />
            <path
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
              fill="#FBBC05"
            />
            <path
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              fill="#EA4335"
            />
          </svg>
          Google로 계속하기
        </Button>
      </div>

      <p className="text-xs text-gray-400 text-center">
        로그인하면 서비스 이용약관 및 개인정보처리방침에 동의하게 됩니다.
      </p>
    </div>
  );
}
