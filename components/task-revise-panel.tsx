'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface RevisePanelTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  sort_order: number | null;
}

interface Proposal {
  op: 'add' | 'update' | 'delete';
  task_id?: string;
  title?: string;
  description?: string | null;
  due_date?: string | null;
  suggested_role?: string | null;
  reason?: string;
  currentTitle?: string;
}

interface TaskRevisePanelProps {
  projectId: string;
  tasks: RevisePanelTask[];
  onApplied: () => void;
}

const LOADING_MESSAGES = [
  '요청을 이해하는 중',
  '일정을 다시 계산하는 중',
  '제안을 정리하는 중',
];

function truncate(text: string, len: number) {
  if (text.length <= len) return text;
  return text.slice(0, len) + '…';
}

const OP_BADGE: Record<Proposal['op'], { label: string; className: string }> = {
  add: { label: '추가', className: 'bg-green-100 text-green-700' },
  update: { label: '수정', className: 'bg-blue-100 text-blue-700' },
  delete: { label: '삭제', className: 'bg-red-100 text-red-700' },
};

export function TaskRevisePanel({ projectId, tasks, onApplied }: TaskRevisePanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [isRequesting, setIsRequesting] = useState(false);
  const [loadingMsgIdx, setLoadingMsgIdx] = useState(0);
  const [requestError, setRequestError] = useState<string | null>(null);

  const [summary, setSummary] = useState<string | null>(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [checked, setChecked] = useState<Record<number, boolean>>({});

  const [isApplying, setIsApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<{
    appliedCount: number;
    failedTitles: string[];
  } | null>(null);

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── 로딩 문구 순환 (5초 간격, 마지막에서 멈춤) ────────────────────────────
  useEffect(() => {
    if (!isRequesting) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    setLoadingMsgIdx(0);
    intervalRef.current = setInterval(() => {
      setLoadingMsgIdx((prev) => {
        if (prev >= LOADING_MESSAGES.length - 1) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return prev;
        }
        return prev + 1;
      });
    }, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [isRequesting]);

  // ── 태스크 조회 헬퍼 ──────────────────────────────────────────────────────
  const findTask = (taskId: string | undefined) =>
    tasks.find((t) => t.id === taskId);

  // ── 요청 전송 ─────────────────────────────────────────────────────────────
  async function handleRequest() {
    const trimmed = instruction.trim();
    if (!trimmed || isRequesting) return;

    setIsRequesting(true);
    setRequestError(null);
    setSummary(null);
    setProposals([]);
    setChecked({});
    setApplyResult(null);

    try {
      const res = await fetch('/api/ai/revise-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, instruction: trimmed }),
      });

      const data = await res.json();

      if (!res.ok) {
        setRequestError('제안을 받지 못했어요. 다시 시도해 주세요.');
        return;
      }

      const rawProposals: Proposal[] = Array.isArray(data.proposals) ? data.proposals : [];

      // update 항목 중 실제로 달라지는 필드가 없는 것은 제외
      const filtered = rawProposals.filter((p) => {
        if (p.op !== 'update') return true;
        const current = findTask(p.task_id);
        if (!current) return false;
        const titleChanged = p.title !== undefined && p.title !== current.title;
        const descChanged =
          (p.description ?? null) !== (current.description ?? null);
        const dueChanged = (p.due_date ?? null) !== (current.due_date ?? null);
        return titleChanged || descChanged || dueChanged;
      });

      setSummary(typeof data.summary === 'string' ? data.summary : '');
      setDroppedCount(typeof data.droppedCount === 'number' ? data.droppedCount : 0);
      setProposals(filtered);

      const initialChecked: Record<number, boolean> = {};
      filtered.forEach((_, idx) => {
        initialChecked[idx] = true;
      });
      setChecked(initialChecked);
    } catch {
      setRequestError('제안을 받지 못했어요. 다시 시도해 주세요.');
    } finally {
      setIsRequesting(false);
    }
  }

  // ── 적용 ──────────────────────────────────────────────────────────────────
  async function handleApply() {
    const selectedIndices = Object.entries(checked)
      .filter(([, v]) => v)
      .map(([k]) => Number(k));

    if (selectedIndices.length === 0 || isApplying) return;

    setIsApplying(true);
    setApplyResult(null);

    const supabase = createClient();
    let appliedCount = 0;
    const failedTitles: string[] = [];

    let nextSortOrder =
      tasks.reduce((max, t) => Math.max(max, t.sort_order ?? 0), 0) + 1;

    for (const idx of selectedIndices) {
      const p = proposals[idx];
      if (!p) continue;

      try {
        if (p.op === 'add') {
          const { data, error } = await supabase
            .from('tasks')
            .insert({
              project_id: projectId,
              title: p.title,
              description: p.description ?? null,
              due_date: p.due_date ?? null,
              suggested_role: p.suggested_role ?? null,
              status: 'pending',
              sort_order: nextSortOrder,
            })
            .select();

          if (error || !data || data.length === 0) {
            failedTitles.push(p.title ?? '(제목 없음)');
          } else {
            appliedCount++;
            nextSortOrder++;
          }
        } else if (p.op === 'update') {
          const { error } = await supabase.rpc('update_task_basic', {
            p_task_id: p.task_id,
            p_title: p.title,
            p_description: p.description ?? null,
            p_due_date: p.due_date ?? null,
          });

          if (error) {
            const isNotAllowed = error.message?.includes('not_allowed');
            failedTitles.push(
              isNotAllowed
                ? `${p.currentTitle ?? '(알 수 없음)'} (권한 없음)`
                : (p.currentTitle ?? '(알 수 없음)'),
            );
          } else {
            appliedCount++;
          }
        } else if (p.op === 'delete') {
          const { error } = await supabase.rpc('set_task_deleted', {
            p_task_id: p.task_id,
            p_deleted: true,
          });

          if (error) {
            const isNotAllowed = error.message?.includes('not_allowed');
            failedTitles.push(
              isNotAllowed
                ? `${p.currentTitle ?? '(알 수 없음)'} (권한 없음)`
                : (p.currentTitle ?? '(알 수 없음)'),
            );
          } else {
            appliedCount++;
          }
        }
      } catch {
        const label =
          p.op === 'add' ? (p.title ?? '(제목 없음)') : (p.currentTitle ?? '(알 수 없음)');
        failedTitles.push(label);
      }
    }

    setApplyResult({ appliedCount, failedTitles });
    onApplied();

    // 제안 목록과 입력창 비우고 접기 (결과 문구는 남김)
    setProposals([]);
    setChecked({});
    setSummary(null);
    setInstruction('');
    setIsOpen(false);
    setIsApplying(false);
  }

  const checkedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="flex items-center gap-2 text-left text-sm font-medium text-gray-700 hover:text-gray-900 transition"
      >
        <span>{isOpen ? '▾' : '▸'}</span>
        <span>AI에게 수정 요청</span>
      </button>

      {isOpen && (
        <div className="flex flex-col gap-3">
          <textarea
            rows={2}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="예: 마감일을 전부 3일씩 미뤄줘 / 홍보 관련 태스크를 하나 추가해줘"
            disabled={isRequesting}
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition resize-none disabled:opacity-50"
          />

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleRequest}
              disabled={!instruction.trim() || isRequesting}
              className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              요청
            </button>

            {isRequesting && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-gray-500">
                  {LOADING_MESSAGES[loadingMsgIdx]}...
                </span>
                <span className="text-[11px] text-gray-400">보통 30초 정도 걸려요</span>
              </div>
            )}
          </div>

          {requestError && <p className="text-xs text-red-500">{requestError}</p>}

          {summary !== null && (
            <div className="flex flex-col gap-3 border-t border-gray-100 pt-3">
              <p className="text-sm text-gray-700">{summary}</p>

              {droppedCount > 0 && (
                <p className="text-xs text-gray-400">
                  해석하지 못한 제안 {droppedCount}건은 제외했어요.
                </p>
              )}

              {proposals.length === 0 ? (
                <p className="text-sm text-gray-500">바꿀 게 없다고 하네요.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {proposals.map((p, idx) => {
                    const badge = OP_BADGE[p.op];
                    return (
                      <label
                        key={idx}
                        className="flex items-start gap-2 rounded-lg border border-gray-100 bg-gray-50 p-3 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={!!checked[idx]}
                          onChange={(e) =>
                            setChecked((prev) => ({ ...prev, [idx]: e.target.checked }))
                          }
                          className="mt-0.5 shrink-0"
                        />
                        <div className="flex flex-col gap-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                            <span className="text-sm font-medium text-gray-900 truncate">
                              {p.op === 'add' ? p.title : p.currentTitle}
                            </span>
                          </div>

                          {p.op === 'add' && (
                            <>
                              <p className="text-xs text-gray-500">
                                {p.due_date ? p.due_date : '마감일 없음'}
                                {p.suggested_role ? ` · ${p.suggested_role}` : ''}
                              </p>
                              {p.reason && (
                                <p className="text-xs text-gray-400">{p.reason}</p>
                              )}
                            </>
                          )}

                          {p.op === 'delete' && p.reason && (
                            <p className="text-xs text-gray-400">{p.reason}</p>
                          )}

                          {p.op === 'update' &&
                            (() => {
                              const current = findTask(p.task_id);
                              const rows: string[] = [];

                              if (current) {
                                if (p.title !== undefined && p.title !== current.title) {
                                  rows.push(`제목: ${current.title} → ${p.title}`);
                                }
                                const curDesc = current.description ?? null;
                                const newDesc = p.description ?? null;
                                if (newDesc !== curDesc) {
                                  const curText = curDesc ? truncate(curDesc, 40) : '없음';
                                  const newText = newDesc ? truncate(newDesc, 40) : '없음';
                                  rows.push(`설명: ${curText} → ${newText}`);
                                }
                                const curDue = current.due_date ?? null;
                                const newDue = p.due_date ?? null;
                                if (newDue !== curDue) {
                                  rows.push(
                                    `마감일: ${curDue ?? '없음'} → ${newDue ?? '없음'}`,
                                  );
                                }
                              }

                              return (
                                <>
                                  {rows.map((r, i) => (
                                    <p key={i} className="text-xs text-gray-600">
                                      {r}
                                    </p>
                                  ))}
                                  {p.reason && (
                                    <p className="text-xs text-gray-400">{p.reason}</p>
                                  )}
                                </>
                              );
                            })()}
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}

              {proposals.length > 0 && (
                <button
                  type="button"
                  onClick={handleApply}
                  disabled={checkedCount === 0 || isApplying}
                  className="self-start rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isApplying ? '적용 중...' : `선택한 ${checkedCount}건 적용`}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {applyResult && (
        <div className="flex flex-col gap-1 border-t border-gray-100 pt-3">
          <p className="text-sm text-gray-700">
            {applyResult.appliedCount}건 적용했어요.
            {applyResult.failedTitles.length > 0 &&
              ` ${applyResult.failedTitles.length}건은 실패했어요.`}
          </p>
          {applyResult.failedTitles.length > 0 && (
            <p className="text-xs text-gray-400">
              {applyResult.failedTitles.join(', ')}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
