'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getRoleLabel, getRoleColor } from '@/lib/roles';
import type { TaskStatus } from '@/types';

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface Role {
  id: string;
  label: string;
}

interface ChecklistTask {
  id: string;
  title: string;
  description: string | null;
  due_date: string | null;
  suggested_role: string | null;
  status: TaskStatus;
  memo: string | null;
}

// ─── 상태 순환 ─────────────────────────────────────────────────────────────

const STATUS_CYCLE: TaskStatus[] = ['pending', 'in_progress', 'completed'];

function nextStatus(current: TaskStatus): TaskStatus {
  const idx = STATUS_CYCLE.indexOf(current);
  return STATUS_CYCLE[(idx + 1) % STATUS_CYCLE.length];
}

// ─── 상태 배지 ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: '대기중', className: 'bg-gray-100 text-gray-500' },
  in_progress: { label: '진행중', className: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', className: 'bg-green-100 text-green-700' },
};

// ─── 태스크 카드 ───────────────────────────────────────────────────────────

function TaskCard({
  task,
  roles,
  currentUserId,
  onStatusChange,
  onMemoChange,
}: {
  task: ChecklistTask;
  roles: Role[];
  currentUserId: string;
  onStatusChange: (id: string, newStatus: TaskStatus) => void;
  onMemoChange: (id: string, memo: string) => void;
}) {
  const { label, className } = STATUS_CONFIG[task.status];
  const isCompleted = task.status === 'completed';

  return (
    <div
      className={`flex flex-col gap-3 rounded-xl border p-4 transition ${
        isCompleted ? 'border-gray-100 bg-gray-50 opacity-70' : 'border-gray-200 bg-white'
      }`}
    >
      {/* 상단: 제목 + 상태 토글 */}
      <div className="flex items-start gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className={`text-sm font-medium text-gray-900 ${
                isCompleted ? 'line-through text-gray-400' : ''
              }`}
            >
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

        {/* 상태 토글 버튼 */}
        <button
          type="button"
          onClick={() => onStatusChange(task.id, nextStatus(task.status))}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition hover:opacity-80 ${className}`}
        >
          {label}
        </button>
      </div>

      {/* 메모 입력창 */}
      <textarea
        defaultValue={task.memo ?? ''}
        onChange={(e) => onMemoChange(task.id, e.target.value)}
        placeholder="메모 (자동 저장)"
        rows={2}
        className="w-full resize-none rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs text-gray-600 placeholder:text-gray-300 outline-none focus:border-gray-300 focus:bg-white transition leading-relaxed"
      />
    </div>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default function ChecklistPage() {
  const { id } = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<ChecklistTask[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);

  // 메모 디바운스 타이머
  const memoTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  // ── 초기 데이터 로드 ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const [tasksRes, projectRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, description, due_date, suggested_role, status, memo')
          .eq('project_id', id)
          .eq('assignee_id', user.id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('projects')
          .select('custom_roles')
          .eq('id', id)
          .single(),
      ]);

      if (tasksRes.data) setTasks(tasksRes.data as ChecklistTask[]);
      if (projectRes.data?.custom_roles) {
        setRoles(projectRes.data.custom_roles as Role[]);
      }
      setIsLoading(false);
    }

    load();
  }, [id]);

  // ── 상태 변경 (낙관적 업데이트) ──────────────────────────────────────────
  const handleStatusChange = useCallback(
    async (taskId: string, newStatus: TaskStatus) => {
      const prev = tasks.find((t) => t.id === taskId);
      if (!prev) return;

      setTasks((ts) =>
        ts.map((t) => (t.id === taskId ? { ...t, status: newStatus } : t)),
      );

      const supabase = createClient();
      const { error } = await supabase
        .from('tasks')
        .update({ status: newStatus, last_modified_by: currentUserId })
        .eq('id', taskId);

      if (error) {
        setTasks((ts) =>
          ts.map((t) => (t.id === taskId ? { ...t, status: prev.status } : t)),
        );
      }
    },
    [tasks, currentUserId],
  );

  // ── 메모 변경 (500ms 디바운스 자동저장) ──────────────────────────────────
  const handleMemoChange = useCallback(
    (taskId: string, memo: string) => {
      setTasks((ts) =>
        ts.map((t) => (t.id === taskId ? { ...t, memo } : t)),
      );

      if (memoTimers.current[taskId]) {
        clearTimeout(memoTimers.current[taskId]);
      }

      memoTimers.current[taskId] = setTimeout(async () => {
        const supabase = createClient();
        await supabase.from('tasks').update({ memo }).eq('id', taskId);
      }, 500);
    },
    [],
  );

  // ─────────────────────────────────────────────────────────────────────────

  const completedCount = tasks.filter((t) => t.status === 'completed').length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900">내 체크리스트</h1>
        {tasks.length > 0 && (
          <span className="text-sm text-gray-400">
            <span className="font-semibold text-gray-700">{completedCount}</span>
            /{tasks.length} 완료
          </span>
        )}
      </div>

      {/* 태스크 목록 */}
      {tasks.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-16 text-center">
          <p className="text-sm font-medium text-gray-500">아직 배정된 태스크가 없어요</p>
          <p className="mt-1 text-xs text-gray-400">
            태스크 선택 화면에서 담당할 태스크를 선택해주세요.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              roles={roles}
              currentUserId={currentUserId}
              onStatusChange={handleStatusChange}
              onMemoChange={handleMemoChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}
