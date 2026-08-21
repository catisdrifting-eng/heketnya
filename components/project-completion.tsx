'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useActionLock } from '@/lib/use-action-lock';

interface ProjectCompletionProps {
  projectId: string;
  status: string;
  isOwner: boolean;
}

interface RetrospectiveStats {
  totalTasks: number;
  completedTasks: number;
  overdueTasks: number;
  memberCount: number;
  messageCount: number;
  durationDays: number;
}

interface RetrospectiveResult {
  summary: string;
  went_well: string[];
  challenges: string[];
  learnings: string[];
  stats: RetrospectiveStats;
}

const LOADING_MESSAGES = ['기록을 훑어보는 중', '회고를 정리하는 중'];

export function ProjectCompletion({
  projectId,
  status,
  isOwner,
}: ProjectCompletionProps) {
  const router = useRouter();

  // ── 완료/되돌리기 확인 상태 ──────────────────────────────────────────────
  const [confirmingComplete, setConfirmingComplete] = useState(false);
  const [confirmingRevert, setConfirmingRevert] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);

  // ── 회고 상태 ─────────────────────────────────────────────────────────
  const [retroLoading, setRetroLoading] = useState(false);
  const [retroLoadingIndex, setRetroLoadingIndex] = useState(0);
  const [retroResult, setRetroResult] = useState<RetrospectiveResult | null>(null);
  const [retroError, setRetroError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { run: runSetStatus, pending: setStatusPending } = useActionLock();
  const { run: runRetrospective, pending: retroActionPending } = useActionLock();

  function clearLoadingInterval() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    return () => {
      clearLoadingInterval();
    };
  }, []);

  async function handleSetStatus(nextStatus: 'completed' | 'active') {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc('set_project_status', {
        p_project_id: projectId,
        p_status: nextStatus,
      });

      if (error) {
        if (error.message?.includes('not_allowed')) {
          setStatusError('권한이 없어요.');
        } else {
          setStatusError('상태를 변경하지 못했어요.');
        }
        return;
      }

      router.refresh();
    } catch {
      setStatusError('상태를 변경하지 못했어요.');
    } finally {
      setStatusLoading(false);
      setConfirmingComplete(false);
      setConfirmingRevert(false);
    }
  }

  async function handleGenerateRetrospective() {
    setRetroLoading(true);
    setRetroLoadingIndex(0);
    setRetroError(null);

    clearLoadingInterval();
    intervalRef.current = setInterval(() => {
      setRetroLoadingIndex((i) => Math.min(i + 1, LOADING_MESSAGES.length - 1));
    }, 4000);

    try {
      const res = await fetch('/api/ai/retrospective', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRetroError('회고를 만들지 못했어요. 다시 시도해 주세요.');
        return;
      }

      setRetroResult(data as RetrospectiveResult);
    } catch {
      setRetroError('회고를 만들지 못했어요. 다시 시도해 주세요.');
    } finally {
      clearLoadingInterval();
      setRetroLoading(false);
    }
  }

  // ── status !== 'completed' ────────────────────────────────────────────
  if (status !== 'completed') {
    if (!isOwner) return null;

    return (
      <div className="rounded-xl border border-gray-100 px-5 py-4">
        {!confirmingComplete ? (
          <button
            type="button"
            onClick={() => setConfirmingComplete(true)}
            className="text-sm text-gray-500 transition hover:text-gray-700"
          >
            프로젝트 완료하기
          </button>
        ) : (
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-700">프로젝트를 완료할까요?</span>
            <button
              type="button"
              onClick={() => runSetStatus(() => handleSetStatus('completed'))}
              disabled={statusLoading || setStatusPending}
              className="text-sm font-medium text-gray-900 transition hover:text-black disabled:opacity-60"
            >
              완료
            </button>
            <button
              type="button"
              onClick={() => setConfirmingComplete(false)}
              disabled={statusLoading}
              className="text-sm text-gray-400 transition hover:text-gray-600 disabled:opacity-60"
            >
              취소
            </button>
          </div>
        )}
        {statusError && <p className="mt-2 text-xs text-red-500">{statusError}</p>}
      </div>
    );
  }

  // ── status === 'completed' ────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-gray-100 px-5 py-4">
      <div className="flex items-center gap-3">
        <span className="text-sm text-gray-700">완료된 프로젝트예요.</span>

        {isOwner && !confirmingRevert && (
          <button
            type="button"
            onClick={() => setConfirmingRevert(true)}
            className="text-xs text-gray-400 transition hover:text-gray-600"
          >
            진행 중으로 되돌리기
          </button>
        )}

        {isOwner && confirmingRevert && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => runSetStatus(() => handleSetStatus('active'))}
              disabled={statusLoading || setStatusPending}
              className="text-xs font-medium text-gray-700 transition hover:text-gray-900 disabled:opacity-60"
            >
              되돌리기
            </button>
            <button
              type="button"
              onClick={() => setConfirmingRevert(false)}
              disabled={statusLoading}
              className="text-xs text-gray-400 transition hover:text-gray-600 disabled:opacity-60"
            >
              취소
            </button>
          </div>
        )}
      </div>

      {statusError && <p className="text-xs text-red-500">{statusError}</p>}

      {/* 회고 영역 */}
      <div className="flex flex-col gap-3">
        {!retroResult && (
          <div className="flex items-center justify-between">
            <button
              type="button"
              onClick={() => runRetrospective(handleGenerateRetrospective)}
              disabled={retroLoading || retroActionPending}
              className="text-sm text-gray-500 transition hover:text-gray-700 disabled:opacity-60"
            >
              {retroLoading ? `${LOADING_MESSAGES[retroLoadingIndex]}...` : '회고 만들기'}
            </button>
          </div>
        )}

        {retroError && <p className="text-xs text-gray-400">{retroError}</p>}

        {retroResult && (
          <div className="relative flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4">
            <button
              type="button"
              onClick={() => runRetrospective(handleGenerateRetrospective)}
              disabled={retroLoading || retroActionPending}
              className="absolute right-3 top-3 text-xs text-gray-400 transition hover:text-gray-600 disabled:opacity-60"
            >
              {retroLoading ? `${LOADING_MESSAGES[retroLoadingIndex]}...` : '다시 만들기'}
            </button>

            <p className="pr-16 text-xs text-gray-400">
              태스크 {retroResult.stats.completedTasks}/{retroResult.stats.totalTasks} 완료 · 팀원{' '}
              {retroResult.stats.memberCount}명 · {retroResult.stats.durationDays}일 진행 · 대화{' '}
              {retroResult.stats.messageCount}건
            </p>

            <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line">
              {retroResult.summary}
            </p>

            {retroResult.went_well.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-gray-900">잘된 것</h3>
                <ul className="list-disc pl-4 text-sm text-gray-700">
                  {retroResult.went_well.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {retroResult.challenges.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-gray-900">어려웠던 것</h3>
                <ul className="list-disc pl-4 text-sm text-gray-700">
                  {retroResult.challenges.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}

            {retroResult.learnings.length > 0 && (
              <div className="flex flex-col gap-1">
                <h3 className="text-xs font-semibold text-gray-900">다음에 할 것</h3>
                <ul className="list-disc pl-4 text-sm text-gray-700">
                  {retroResult.learnings.map((item, idx) => (
                    <li key={idx}>{item}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
