'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface WeeklySummary {
  id: string;
  content: string;
  created_at: string;
}

interface WeeklySummaryCardProps {
  projectId: string;
}

const MIN_INTERVAL_MS = 60 * 60 * 1000; // 1시간

function formatDateTime(iso: string) {
  const date = new Date(iso);
  const dateStr = date.toLocaleDateString('ko-KR', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const timeStr = date.toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${dateStr} ${timeStr}`;
}

// 남은 시간을 "N분" 형태로 표기
function formatRemaining(ms: number) {
  const minutes = Math.max(1, Math.ceil(ms / 60000));
  return `${minutes}분`;
}

export function WeeklySummaryCard({ projectId }: WeeklySummaryCardProps) {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  // ── 최신 요약 로드 ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from('project_summaries')
        .select('id, content, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!cancelled) {
        setSummary(data as WeeklySummary | null);
        setIsLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // ── 남은 시간 표시를 위한 1분 간격 tick ────────────────────────────────────
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const elapsed = summary ? now - new Date(summary.created_at).getTime() : Infinity;
  const isCoolingDown = elapsed < MIN_INTERVAL_MS;
  const remainingMs = MIN_INTERVAL_MS - elapsed;

  // ── 요약 생성 ─────────────────────────────────────────────────────────────
  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);

    try {
      const res = await fetch('/api/ai/weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? '요약 생성에 실패했어요.');
        return;
      }

      setSummary(data.summary as WeeklySummary);
      setNow(Date.now());
    } catch {
      setError('네트워크 오류가 발생했어요. 다시 시도해주세요.');
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-white p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold text-gray-900">AI 주간 요약</h2>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating || isCoolingDown || isLoading}
          className="shrink-0 rounded-lg bg-gray-900 px-3.5 py-1.5 text-xs font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isGenerating
            ? '생성 중...'
            : isCoolingDown
              ? `${formatRemaining(remainingMs)} 후 재생성 가능`
              : '요약 생성'}
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-8">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
        </div>
      ) : isGenerating ? (
        // 로드맵 채팅의 로딩 인디케이터 패턴 재사용 (20~30초 소요될 수 있음)
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-center">
          <div className="flex items-center gap-1 rounded-xl bg-gray-100 px-4 py-2.5">
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:0ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400 [animation-delay:300ms]" />
          </div>
          <p className="text-xs text-gray-400">
            AI가 팀 진행 상황을 분석하고 있어요. 최대 30초 정도 걸릴 수 있어요.
          </p>
        </div>
      ) : summary ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm leading-relaxed text-gray-700 whitespace-pre-line">
            {summary.content}
          </p>
          <p className="text-xs text-gray-400">
            {formatDateTime(summary.created_at)}에 생성됨
          </p>
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
          <p className="text-sm font-medium text-gray-500">아직 요약이 없습니다</p>
          <p className="text-xs text-gray-400">
            요약 생성 버튼을 눌러 AI 주간 요약을 만들어보세요.
          </p>
        </div>
      )}

      {error && <p className="text-xs text-red-500">{error}</p>}
    </section>
  );
}
