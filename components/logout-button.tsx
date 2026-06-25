'use client';

import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="text-xs text-gray-400 hover:text-gray-700 transition"
    >
      로그아웃
    </button>
  );
}
