'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { getRoleLabel, getRoleColor } from '@/lib/roles';

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface Role {
  id: string;
  label: string;
}

interface Task {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  suggested_role: string | null;
  assignee_id: string | null;
  sort_order: number;
}

// ─── 토스트 ────────────────────────────────────────────────────────────────

function Toast({ message, onClose }: { message: string; onClose: () => void }) {
  useEffect(() => {
    const t = setTimeout(onClose, 3000);
    return () => clearTimeout(t);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-xl bg-gray-900 px-5 py-3 text-sm text-white shadow-lg">
      {message}
    </div>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default function SelectPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [tasks, setTasks] = useState<Task[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [assigneeNames, setAssigneeNames] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [unclaimingId, setUnclaimingId] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);

  // ── 초기 데이터 로드 ──────────────────────────────────────────────────────
  useEffect(() => {
    const supabase = createClient();

    async function load() {
      // 현재 유저
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      // 역할 미선언 시 역할 선택 페이지로 리다이렉트
      const { data: member } = await supabase
        .from('project_members')
        .select('role_preference')
        .eq('project_id', id)
        .eq('user_id', user.id)
        .single();

      if (!member?.role_preference) {
        router.replace(`/project/${id}/role`);
        return;
      }

      setCurrentUserId(user.id);

      // tasks + custom_roles 조회
      const [tasksRes, projectRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, description, due_date, suggested_role, assignee_id, sort_order')
          .eq('project_id', id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('projects')
          .select('custom_roles')
          .eq('id', id)
          .single(),
      ]);

      if (tasksRes.data) {
        setTasks(tasksRes.data as Task[]);
        await loadAssigneeNames(tasksRes.data as Task[], supabase);
      }
      if (projectRes.data?.custom_roles) {
        setRoles(projectRes.data.custom_roles as Role[]);
      }
    }

    load();

    // ── Realtime 구독 ──────────────────────────────────────────────────────
    const channel = supabase
      .channel(`tasks-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'tasks',
          filter: `project_id=eq.${id}`,
        },
        async (payload) => {
          const updated = payload.new as Task;
          setTasks((prev) =>
            prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
          );
          // 새 assignee 이름 로드
          if (updated.assignee_id) {
            const { data: userData } = await supabase
              .from('users')
              .select('id, name, email')
              .eq('id', updated.assignee_id)
              .single();
            if (userData) {
              setAssigneeNames((prev) => ({
                ...prev,
                [updated.assignee_id!]: userData.name ?? userData.email ?? '팀원',
              }));
            }
          }
        },
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  async function loadAssigneeNames(
    taskList: Task[],
    supabase: ReturnType<typeof createClient>,
  ) {
    const assigneeIds = [
      ...new Set(taskList.map((t) => t.assignee_id).filter(Boolean) as string[]),
    ];
    if (assigneeIds.length === 0) return;

    const { data } = await supabase
      .from('users')
      .select('id, name, email')
      .in('id', assigneeIds);

    if (data) {
      const map: Record<string, string> = {};
      data.forEach((u) => {
        map[u.id] = u.name ?? u.email ?? '팀원';
      });
      setAssigneeNames(map);
    }
  }

  // ── 태스크 선택 ───────────────────────────────────────────────────────────
  async function handleClaim(taskId: string) {
    if (!currentUserId || claimingId) return;
    setClaimingId(taskId);

    try {
      const supabase = createClient();

      // RPC claim_task(task_id, user_id) 호출
      const { data, error } = await supabase.rpc('claim_task', {
        p_task_id: taskId,
        p_user_id: currentUserId,
      });

      if (error || data === false) {
        setToast('이미 다른 팀원이 선택했어요.');
        return;
      }

      // 낙관적 업데이트
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, assignee_id: currentUserId } : t,
        ),
      );
      setAssigneeNames((prev) => ({ ...prev, [currentUserId]: '나' }));
    } finally {
      setClaimingId(null);
    }
  }

  // ── 태스크 선택 취소 ──────────────────────────────────────────────────────
  async function handleUnclaim(taskId: string) {
    if (!currentUserId || unclaimingId) return;
    setUnclaimingId(taskId);

    // 낙관적 업데이트
    setTasks((prev) =>
      prev.map((t) =>
        t.id === taskId ? { ...t, assignee_id: null } : t,
      ),
    );

    try {
      const supabase = createClient();
      const { error } = await supabase
        .from('tasks')
        .update({ assignee_id: null, is_claimed: false, claimed_at: null })
        .eq('id', taskId);

      if (error) {
        // 롤백
        setTasks((prev) =>
          prev.map((t) =>
            t.id === taskId ? { ...t, assignee_id: currentUserId } : t,
          ),
        );
        setToast('선택 취소에 실패했어요.');
      }
    } finally {
      setUnclaimingId(null);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <>
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <div className="flex flex-col gap-6">
        {/* 헤더 */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">태스크 선택</h1>
            <p className="mt-1 text-sm text-gray-400">
              담당할 태스크를 선택해주세요. 실시간으로 반영됩니다.
            </p>
          </div>
          <Button size="sm" onClick={() => router.push(`/project/${id}`)}>
            선택 완료
          </Button>
        </div>

        {/* 태스크 목록 */}
        {tasks.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
            <p className="text-sm text-gray-400">태스크가 없어요.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {tasks.map((task) => {
              const isMine = task.assignee_id === currentUserId;
              const isTaken = !!task.assignee_id && !isMine;
              const assigneeName = task.assignee_id
                ? assigneeNames[task.assignee_id] ?? '팀원'
                : null;

              return (
                <div
                  key={task.id}
                  className={`flex items-start gap-4 rounded-xl border p-4 transition ${
                    isMine
                      ? 'border-black bg-gray-50'
                      : isTaken
                        ? 'border-gray-100 bg-gray-50 opacity-60'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                  }`}
                >
                  {/* 태스크 정보 */}
                  <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium text-gray-900">
                        {task.title}
                      </span>
                      {task.suggested_role && (
                        <span
                          className={`text-xs font-medium rounded-full px-2 py-0.5 ${getRoleColor(task.suggested_role)}`}
                        >
                          {getRoleLabel(task.suggested_role, roles)}
                        </span>
                      )}
                    </div>

                    {task.description && (
                      <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">
                        {task.description}
                      </p>
                    )}

                    {task.due_date && (
                      <p className="text-xs text-gray-400">
                        마감{' '}
                        {new Date(task.due_date).toLocaleDateString('ko-KR', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    )}
                  </div>

                  {/* 선택 버튼 */}
                  <div className="shrink-0 flex flex-col gap-1.5 items-end">
                    {isMine ? (
                      <>
                        <span className="inline-flex items-center rounded-lg bg-black px-3 py-1.5 text-xs font-medium text-white">
                          내가 선택함 ✓
                        </span>
                        <button
                          type="button"
                          disabled={unclaimingId === task.id}
                          onClick={() => handleUnclaim(task.id)}
                          className="text-xs text-gray-400 hover:text-red-500 transition disabled:opacity-40"
                        >
                          {unclaimingId === task.id ? '취소 중...' : '선택 취소'}
                        </button>
                      </>
                    ) : isTaken ? (
                      <span className="inline-flex items-center rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500">
                        {assigneeName}
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={claimingId === task.id}
                        onClick={() => handleClaim(task.id)}
                      >
                        {claimingId === task.id ? '...' : '선택하기'}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
