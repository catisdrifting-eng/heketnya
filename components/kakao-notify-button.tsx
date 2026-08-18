'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface KakaoNotifyButtonProps {
  projectId: string;
}

export function KakaoNotifyButton({ projectId }: KakaoNotifyButtonProps) {
  const [isKakaoUser, setIsKakaoUser] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(
    null,
  );

  // ── 카카오 로그인 사용자인지 확인 ─────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function check() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!cancelled) {
        setIsKakaoUser(user?.app_metadata?.provider === 'kakao');
        setIsChecking(false);
      }
    }

    check();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleNotify() {
    setIsSending(true);
    setResult(null);

    try {
      const res = await fetch('/api/notify/kakao', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setResult({ type: 'error', message: data.error ?? '알림 발송에 실패했어요.' });
        return;
      }

      if (data.notified === false) {
        setResult({ type: 'success', message: data.message ?? '발송할 일정이 없어요.' });
        return;
      }

      setResult({ type: 'success', message: '카카오톡으로 일정을 보냈어요! 📩' });
    } catch {
      setResult({ type: 'error', message: '네트워크 오류가 발생했어요. 다시 시도해주세요.' });
    } finally {
      setIsSending(false);
    }
  }

  if (isChecking) {
    return null;
  }

  if (!isKakaoUser) {
    return (
      <p className="text-xs text-gray-400">
        카카오 계정으로 로그인하면 내 일정을 카톡으로 받을 수 있어요.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 items-end">
      <button
        type="button"
        onClick={handleNotify}
        disabled={isSending}
        className="inline-flex items-center gap-2 rounded-lg bg-[#FEE500] px-4 py-2 text-sm font-medium text-black transition hover:bg-[#FEE500]/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSending ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-black/20 border-t-black" />
            발송 중...
          </>
        ) : (
          <>💬 내 일정 카톡으로 받기</>
        )}
      </button>

      {result && (
        <p
          className={`text-xs ${result.type === 'success' ? 'text-green-600' : 'text-red-500'}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
