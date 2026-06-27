'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface AssignButtonProps {
  projectId: string;
}

export default function AssignButton({ projectId }: AssignButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleAssign() {
    setIsLoading(true);
    setError(null);
    setSummary(null);

    try {
      const res = await fetch('/api/ai/assign-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? 'AI 배정에 실패했어요.');
        return;
      }

      setSummary(data.summary ?? '배정이 완료되었습니다.');
      // 잠시 후 새로고침
      setTimeout(() => {
        router.refresh();
      }, 1500);
    } catch {
      setError('네트워크 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={handleAssign}
        disabled={isLoading}
        className="inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isLoading ? (
          <>
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
            배정 중...
          </>
        ) : (
          <>
            <span>✨</span>
            AI 배정 실행
          </>
        )}
      </button>

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {summary && (
        <p className="text-xs text-green-600">{summary}</p>
      )}
    </div>
  );
}
