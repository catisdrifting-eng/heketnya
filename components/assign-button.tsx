'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useActionLock } from '@/lib/use-action-lock';

interface AssignButtonProps {
  projectId: string;
}

const LOADING_MESSAGES = [
  '팀원 역할을 분석하는 중',
  '업무와 역량을 맞추는 중',
  '배정 결과를 정리하는 중',
];

const TOTAL_DURATION_MS = 30000; // 30초에 걸쳐 진행 막대가 채워짐
const MAX_PROGRESS_BEFORE_DONE = 95;

export default function AssignButton({ projectId }: AssignButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [messageIndex, setMessageIndex] = useState(0);
  const [progress, setProgress] = useState(0);

  const messageTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const { run: runAssign, pending: assignPending } = useActionLock();

  function clearTimers() {
    if (messageTimerRef.current) {
      clearInterval(messageTimerRef.current);
      messageTimerRef.current = null;
    }
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current);
      progressTimerRef.current = null;
    }
  }

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      clearTimers();
    };
  }, []);

  async function handleAssign() {
    setIsLoading(true);
    setError(null);
    setSummary(null);
    setMessageIndex(0);
    setProgress(0);
    startTimeRef.current = Date.now();

    // 문구 5초 간격 순환 (마지막 문구 도달 시 유지)
    messageTimerRef.current = setInterval(() => {
      setMessageIndex((prev) =>
        prev < LOADING_MESSAGES.length - 1 ? prev + 1 : prev,
      );
    }, 5000);

    // 경과 시간 기반 진행 막대 (0% → 95%, 30초 기준)
    progressTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const ratio = Math.min(elapsed / TOTAL_DURATION_MS, 1);
      setProgress(Math.min(ratio * MAX_PROGRESS_BEFORE_DONE, MAX_PROGRESS_BEFORE_DONE));
    }, 200);

    try {
      const res = await fetch('/api/ai/assign-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await res.json();

      clearTimers();

      if (!res.ok) {
        setError(data.error ?? 'AI 배정에 실패했어요.');
        return;
      }

      // 응답 도착 시 100%로 채운 뒤 화면 전환
      setProgress(100);
      setSummary(data.summary ?? '배정이 완료되었습니다.');
      // 잠시 후 새로고침
      setTimeout(() => {
        router.refresh();
      }, 600);
    } catch {
      clearTimers();
      setError('네트워크 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => runAssign(handleAssign)}
        disabled={isLoading || assignPending}
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

      {isLoading && (
        <div className="flex flex-col gap-1.5">
          <p className="text-xs font-medium text-gray-700">
            {LOADING_MESSAGES[messageIndex]}
          </p>
          <p className="text-xs text-gray-400">보통 30초 정도 걸려요</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full bg-gray-900 transition-all duration-200 ease-linear"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-red-500">{error}</p>
      )}

      {summary && (
        <p className="text-xs text-green-600">{summary}</p>
      )}
    </div>
  );
}
