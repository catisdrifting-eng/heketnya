'use client';

import { useEffect, useRef, useState } from 'react';

interface ChatSummaryProps {
  projectId: string;
}

interface SummaryResult {
  summary: string;
  decisions: string[];
  todos: string[];
  open_questions: string[];
  messageCount: number;
}

const LOADING_MESSAGES = ['대화를 읽는 중', '정리하는 중'];

export function ChatSummary({ projectId }: ChatSummaryProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(0);
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [isEmpty, setIsEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  async function handleClick() {
    setIsLoading(true);
    setLoadingIndex(0);
    setResult(null);
    setIsEmpty(false);
    setError(null);

    clearLoadingInterval();
    intervalRef.current = setInterval(() => {
      setLoadingIndex((i) => Math.min(i + 1, LOADING_MESSAGES.length - 1));
    }, 3000);

    try {
      const res = await fetch('/api/ai/summarize-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError('요약을 만들지 못했어요. 다시 시도해 주세요.');
        return;
      }

      if (data.empty) {
        setIsEmpty(true);
        return;
      }

      setResult(data as SummaryResult);
    } catch {
      setError('요약을 만들지 못했어요. 다시 시도해 주세요.');
    } finally {
      clearLoadingInterval();
      setIsLoading(false);
    }
  }

  function handleClose() {
    setResult(null);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-end">
        <button
          type="button"
          onClick={handleClick}
          disabled={isLoading}
          className="text-xs text-gray-400 transition hover:text-gray-600 disabled:opacity-60"
        >
          {isLoading ? `${LOADING_MESSAGES[loadingIndex]}...` : '대화 요약'}
        </button>
      </div>

      {isEmpty && (
        <p className="text-xs text-gray-400">
          요약할 만큼 대화가 쌓이지 않았어요.
        </p>
      )}

      {error && <p className="text-xs text-gray-400">{error}</p>}

      {result && (
        <div className="relative flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4">
          <button
            type="button"
            onClick={handleClose}
            aria-label="닫기"
            className="absolute right-3 top-3 text-gray-400 transition hover:text-gray-600"
          >
            ×
          </button>

          <p className="pr-6 text-xs text-gray-400">
            최근 {result.messageCount}개 메시지 요약
          </p>

          <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line">
            {result.summary}
          </p>

          {result.decisions.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-gray-900">정해진 것</h3>
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {result.decisions.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {result.todos.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-gray-900">할 일</h3>
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {result.todos.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {result.open_questions.length > 0 && (
            <div className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-gray-900">
                아직 안 정해진 것
              </h3>
              <ul className="list-disc pl-4 text-sm text-gray-700">
                {result.open_questions.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
