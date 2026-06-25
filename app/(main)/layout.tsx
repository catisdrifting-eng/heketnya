import React from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { LogoutButton } from '@/components/logout-button';

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  return (
    <div className="min-h-screen bg-white">
      {/* 상단 네비게이션 */}
      <header className="border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <span className="text-sm font-semibold tracking-tight text-gray-900">
          HEKETNYA
        </span>
        <div className="flex items-center gap-4">
          <span className="text-xs text-gray-400">{user.email}</span>
          <LogoutButton />
        </div>
      </header>

      {/* 메인 콘텐츠 */}
      <main className="max-w-3xl mx-auto px-6 py-12">
        {children}
      </main>
    </div>
  );
}
