'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getRoleLabel, getRoleColor } from '@/lib/roles';
import { WeeklySummaryCard } from '@/components/weekly-summary-card';
import type { TaskStatus } from '@/types';


// ─── 타입 ──────────────────────────────────────────────────────────────────

interface Role {
  id: string;
  label: string;
}

interface DashboardTask {
  id: string;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  due_date: string | null;
  suggested_role: string | null;
  sort_order: number | null;
}


interface TeamMember {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
}

interface MemberStats {
  user_id: string;
  name: string;
  email: string;
  avatar_url: string | null;
  total: number;
  completed: number;
}

// ─── 상태 배지 ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<TaskStatus, { label: string; className: string }> = {
  pending: { label: '대기중', className: 'bg-gray-100 text-gray-500' },
  in_progress: { label: '진행중', className: 'bg-blue-100 text-blue-700' },
  completed: { label: '완료', className: 'bg-green-100 text-green-700' },
};

const STATUS_ORDER: TaskStatus[] = ['pending', 'in_progress', 'completed'];

const STATUS_GROUP_LABELS: Record<TaskStatus, string> = {
  pending: '대기중',
  in_progress: '진행중',
  completed: '완료',
};

// ─── 이니셜 아바타 ─────────────────────────────────────────────────────────

function InitialAvatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const initial = name.trim().charAt(0).toUpperCase();
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-purple-100 text-purple-700',
    'bg-green-100 text-green-700',
    'bg-orange-100 text-orange-700',
    'bg-pink-100 text-pink-700',
    'bg-teal-100 text-teal-700',
  ];
  // 이름 기반으로 색상 고정
  const colorIdx =
    name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;
  const sizeClass = size === 'sm' ? 'h-7 w-7 text-xs' : 'h-9 w-9 text-sm';

  return (
    <div
      className={`flex items-center justify-center rounded-full font-semibold shrink-0 ${sizeClass} ${colors[colorIdx]}`}
    >
      {initial}
    </div>
  );
}

// ─── 프로그레스 바 ─────────────────────────────────────────────────────────

function ProgressBar({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-2 w-full rounded-full bg-gray-100 overflow-hidden ${className}`}>
      <div
        className="h-full rounded-full bg-gray-900 transition-all duration-500"
        style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
      />
    </div>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default function ProjectDashboardPage() {
  const params = useParams<{ id: string | string[] }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const [tasks, setTasks] = useState<DashboardTask[]>([]);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── 개설자 판단 ───────────────────────────────────────────────────────────
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const isOwner = !!currentUserId && !!ownerId && currentUserId === ownerId;

  // ── 태스크 추가 폼 상태 ───────────────────────────────────────────────────
  const [newTitle, setNewTitle] = useState('');
  const [newAssigneeId, setNewAssigneeId] = useState<string>('');
  const [newDueDate, setNewDueDate] = useState('');
  const [newRole, setNewRole] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // ── 태스크 삭제 상태 ──────────────────────────────────────────────────────
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // ── 담당자 변경 상태 ──────────────────────────────────────────────────────
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  // ── 데이터 로드 (초기 로드 + 재조회 공용) ─────────────────────────────────
  const load = useCallback(async () => {
    const supabase = createClient();

    const { data: userData } = await supabase.auth.getUser();
    setCurrentUserId(userData?.user?.id ?? null);

    const [tasksRes, membersRes, projectRes] = await Promise.all([
      supabase
        .from('tasks')
        .select('id, title, status, assignee_id, due_date, suggested_role, sort_order')
        .eq('project_id', id)
        .order('sort_order', { ascending: true }),
      supabase
        .from('project_members')
        .select('user_id, users(id, name, email, avatar_url)')
        .eq('project_id', id),
      supabase
        .from('projects')
        .select('custom_roles, owner_id')
        .eq('id', id)
        .single(),
    ]);

    if (tasksRes.data) setTasks(tasksRes.data as DashboardTask[]);
    if (projectRes.data?.custom_roles) {
      setRoles(projectRes.data.custom_roles as Role[]);
    }
    setOwnerId(projectRes.data?.owner_id ?? null);

    if (membersRes.data) {
      const parsed: TeamMember[] = membersRes.data.map((row: any) => ({
        user_id: row.user_id,
        name: row.users?.name ?? row.users?.email ?? '알 수 없음',
        email: row.users?.email ?? '',
        avatar_url: row.users?.avatar_url ?? null,
      }));
      setMembers(parsed);
    }

    setIsLoading(false);
  }, [id]);


  useEffect(() => {
    load();
  }, [load]);

  // ── 태스크 추가 ───────────────────────────────────────────────────────────
  const handleAddTask = useCallback(async () => {
    const title = newTitle.trim();
    if (!title || isAdding) return;

    setIsAdding(true);
    setAddError(null);

    try {
      const supabase = createClient();

      const maxSortOrder = tasks.reduce(
        (max, t) => Math.max(max, t.sort_order ?? 0),
        0,
      );

      const { error } = await supabase.from('tasks').insert({
        project_id: id,
        title,
        assignee_id: newAssigneeId || null,
        due_date: newDueDate || null,
        suggested_role: newRole.trim() || null,
        description: newDescription.trim() || null,
        status: 'pending',
        sort_order: tasks.length === 0 ? 0 : maxSortOrder + 1,
      });

      if (error) {
        setAddError('태스크 추가에 실패했어요.');
        return;
      }

      setNewTitle('');
      setNewAssigneeId('');
      setNewDueDate('');
      setNewRole('');
      setNewDescription('');
      await load();
    } finally {
      setIsAdding(false);
    }
  }, [newTitle, newAssigneeId, newDueDate, newRole, newDescription, isAdding, tasks, id, load]);


  // ── 태스크 삭제 ───────────────────────────────────────────────────────────
  const handleDeleteTask = useCallback(
    async (taskId: string, title: string) => {
      setDeletingId(taskId);
      setDeleteError(null);

      try {
        const supabase = createClient();
        const { error } = await supabase.from('tasks').delete().eq('id', taskId);

        if (error) {
          setDeleteError(`'${title}' 삭제에 실패했어요.`);
          setConfirmingDeleteId(null);
          return;
        }

        setConfirmingDeleteId(null);
        await load();
      } finally {
        setDeletingId(null);
      }
    },
    [load],
  );

  // ── 담당자 변경 ───────────────────────────────────────────────────────────
  const handleAssigneeChange = useCallback(
    async (task: DashboardTask, newAssigneeId: string) => {
      const normalized = newAssigneeId === '' ? null : newAssigneeId;
      const previousAssigneeId = task.assignee_id;

      // 낙관적 업데이트
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, assignee_id: normalized } : t)),
      );
      setAssigningId(task.id);
      setAssignError(null);

      try {
        const supabase = createClient();
        const { data, error } = await supabase
          .from('tasks')
          .update({ assignee_id: normalized })
          .eq('id', task.id)
          .select();

        if (error || !data || data.length === 0) {
          setTasks((prev) =>
            prev.map((t) =>
              t.id === task.id ? { ...t, assignee_id: previousAssigneeId } : t,
            ),
          );
          setAssignError(`'${task.title}' 담당자 변경에 실패했어요.`);
          return;
        }

        await load();
      } finally {
        setAssigningId(null);
      }
    },
    [load],
  );

  // ── Realtime 구독 ─────────────────────────────────────────────────────────

  useEffect(() => {
    const supabase = createClient();

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
        (payload) => {
          const updated = payload.new as DashboardTask;
          setTasks((prev) =>
            prev.map((t) => (t.id === updated.id ? { ...t, ...updated } : t)),
          );
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);

  // ── 통계 계산 ─────────────────────────────────────────────────────────────

  const totalCount = tasks.length;
  const completedCount = tasks.filter((t) => t.status === 'completed').length;
  const inProgressCount = tasks.filter((t) => t.status === 'in_progress').length;
  const pendingCount = tasks.filter((t) => t.status === 'pending').length;
  const overallPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const completedPct = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;
  const inProgressPct = totalCount > 0 ? (inProgressCount / totalCount) * 100 : 0;
  const pendingPct = totalCount > 0 ? (pendingCount / totalCount) * 100 : 0;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const overdueCount = tasks.filter((t) => {
    if (!t.due_date || t.status === 'completed') return false;
    return new Date(t.due_date) < today;
  }).length;

  const memberStats: MemberStats[] = members.map((m) => {
    const myTasks = tasks.filter((t) => t.assignee_id === m.user_id);
    const myCompleted = myTasks.filter((t) => t.status === 'completed').length;
    return {
      ...m,
      total: myTasks.length,
      completed: myCompleted,
    };
  });

  // 담당 태스크가 있는 멤버 우선 정렬
  memberStats.sort((a, b) => b.total - a.total);

  // 상태별 그룹핑
  const groupedTasks: Record<TaskStatus, DashboardTask[]> = {
    pending: [],
    in_progress: [],
    completed: [],
  };
  for (const task of tasks) {
    groupedTasks[task.status].push(task);
  }

  // 담당자 이름 조회 헬퍼
  const getMemberName = (userId: string | null) => {
    if (!userId) return '미배정';
    const m = members.find((m) => m.user_id === userId);
    return m ? m.name : '알 수 없음';
  };

  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      {/* ── 팀 전체 진행 현황 ────────────────────────────────────────────── */}
      <section className="flex flex-col gap-4 rounded-xl border border-gray-100 bg-white p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-gray-900">팀 전체 진행 현황</h2>
          <span className="text-lg font-bold text-gray-900">{overallPct}%</span>
        </div>

        {/* 가로 막대: 완료/진행중/대기 비율 */}
        {totalCount > 0 ? (
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full bg-green-500 transition-all duration-500"
              style={{ width: `${completedPct}%` }}
            />
            <div
              className="h-full bg-blue-400 transition-all duration-500"
              style={{ width: `${inProgressPct}%` }}
            />
            <div
              className="h-full bg-gray-200 transition-all duration-500"
              style={{ width: `${pendingPct}%` }}
            />
          </div>
        ) : (
          <div className="h-3 w-full rounded-full bg-gray-100" />
        )}

        {/* 범례 + 숫자 */}
        <div className="flex flex-wrap gap-4 text-xs text-gray-500">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-green-500" />
            완료 <span className="font-semibold text-gray-700">{completedCount}</span>개
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-blue-400" />
            진행중 <span className="font-semibold text-gray-700">{inProgressCount}</span>개
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full bg-gray-300" />
            대기 <span className="font-semibold text-gray-700">{pendingCount}</span>개
          </span>
          <span className="ml-auto text-gray-400">
            전체 <span className="font-semibold text-gray-600">{totalCount}</span>개
          </span>
        </div>

        {/* 기한 초과 경고 */}
        {overdueCount > 0 && (
          <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
            <span>⚠️</span>
            <span>
              마감일이 지난 미완료 태스크{' '}
              <span className="font-semibold">{overdueCount}개</span>
            </span>
          </div>
        )}
      </section>

      {/* ── AI 주간 요약 ─────────────────────────────────────────────────── */}
      <WeeklySummaryCard projectId={id} />

      {/* ── 팀원별 달성률 ───────────────────────────────────────────────── */}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold text-gray-900">팀원별 달성률</h2>

        {memberStats.length === 0 ? (
          <p className="text-sm text-gray-400">팀원 정보가 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {memberStats.map((m) => {
              const pct =
                m.total > 0 ? Math.round((m.completed / m.total) * 100) : 0;
              return (
                <div
                  key={m.user_id}
                  className="flex flex-col gap-3 rounded-xl border border-gray-100 bg-white p-4"
                >
                  {/* 이름 + 아바타 */}
                  <div className="flex items-center gap-3">
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt={m.name}
                        className="h-9 w-9 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <InitialAvatar name={m.name} />
                    )}
                    <div className="flex flex-col min-w-0">
                      <span className="text-sm font-medium text-gray-900 truncate">
                        {m.name}
                      </span>
                      <span className="text-xs text-gray-400 truncate">{m.email}</span>
                    </div>
                    <span className="ml-auto text-sm font-semibold text-gray-700 shrink-0">
                      {pct}%
                    </span>
                  </div>

                  {/* 프로그레스 바 */}
                  <ProgressBar value={pct} />

                  {/* 태스크 수 */}
                  <p className="text-xs text-gray-400">
                    담당{' '}
                    <span className="font-medium text-gray-600">{m.total}</span>개 ·
                    완료{' '}
                    <span className="font-medium text-gray-600">{m.completed}</span>개
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── 태스크 전체 목록 ─────────────────────────────────────────────── */}
      <section className="flex flex-col gap-6">
        <h2 className="text-lg font-semibold text-gray-900">태스크 전체 목록</h2>

        {/* 삭제 에러 메시지 (섹션 상단) */}
        {deleteError && (
          <p className="text-xs text-red-500">{deleteError}</p>
        )}

        {/* 담당자 변경 에러 메시지 (섹션 상단) */}
        {assignError && (
          <p className="text-xs text-red-500">{assignError}</p>
        )}


        {/* 태스크 추가 폼 */}
        <div className="flex flex-col gap-2 rounded-xl border border-gray-100 bg-gray-50 p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              placeholder="새 태스크 제목"
              className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition"
            />
            <select
              value={newAssigneeId}
              onChange={(e) => setNewAssigneeId(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition"
            >
              <option value="">미지정</option>
              {members.map((m) => (
                <option key={m.user_id} value={m.user_id}>
                  {m.name || m.email}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={newDueDate}
              onChange={(e) => setNewDueDate(e.target.value)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition"
            />
            <button
              type="button"
              onClick={handleAddTask}
              disabled={!newTitle.trim() || isAdding}
              className="shrink-0 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isAdding ? '추가 중...' : '추가'}
            </button>
          </div>
          {addError && <p className="text-xs text-red-500">{addError}</p>}
        </div>

        {totalCount === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-16 text-center">

            <p className="text-sm font-medium text-gray-500">아직 태스크가 없어요</p>
            <p className="mt-1 text-xs text-gray-400">
              로드맵 화면에서 태스크를 생성해주세요.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-8">
            {STATUS_ORDER.map((status) => {
              const group = groupedTasks[status];
              if (group.length === 0) return null;
              return (
                <div key={status} className="flex flex-col gap-3">
                  {/* 그룹 헤더 */}
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CONFIG[status].className}`}
                    >
                      {STATUS_GROUP_LABELS[status]}
                    </span>
                    <span className="text-xs text-gray-400">{group.length}개</span>
                  </div>

                  {/* 태스크 행 */}
                  <div className="flex flex-col gap-2">
                    {group.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3"
                      >
                        {/* 제목 */}
                        <span
                          className={`flex-1 min-w-0 text-sm font-medium truncate ${
                            task.status === 'completed'
                              ? 'line-through text-gray-400'
                              : 'text-gray-900'
                          }`}
                        >
                          {task.title}
                        </span>

                        {/* 담당자 */}
                        <div className="flex items-center gap-1.5 shrink-0">
                          <InitialAvatar
                            name={getMemberName(task.assignee_id)}
                            size="sm"
                          />
                          {(() => {
                            const isSelf =
                              !!currentUserId && task.assignee_id === currentUserId;
                            const disabled =
                              assigningId === task.id ||
                              (!isOwner && !!task.assignee_id && !isSelf) ||
                              (!isOwner && isSelf);

                            // 옵션 구성
                            let options: { value: string; label: string }[];
                            if (isOwner) {
                              options = [
                                { value: '', label: '미지정' },
                                ...members.map((m) => ({
                                  value: m.user_id,
                                  label: m.name || m.email,
                                })),
                              ];
                            } else {
                              options = [];
                              if (task.assignee_id && !isSelf) {
                                options.push({
                                  value: task.assignee_id,
                                  label: getMemberName(task.assignee_id),
                                });
                              }
                              const me = members.find(
                                (m) => m.user_id === currentUserId,
                              );
                              if (me) {
                                options.push({
                                  value: me.user_id,
                                  label: me.name || me.email,
                                });
                              }
                            }

                            return (
                              <select
                                value={task.assignee_id ?? ''}
                                disabled={disabled}
                                onChange={(e) =>
                                  handleAssigneeChange(task, e.target.value)
                                }
                                className="rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs text-gray-700 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                {options.map((o) => (
                                  <option key={o.value || '__none__'} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            );
                          })()}
                        </div>


                        {/* 마감일 */}
                        {task.due_date && (
                          <span className="text-xs text-gray-400 shrink-0">
                            {new Date(task.due_date).toLocaleDateString('ko-KR', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        )}

                        {/* 역할 배지 */}
                        {task.suggested_role && (
                          <span
                            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${getRoleColor(task.suggested_role)}`}
                          >
                            {getRoleLabel(task.suggested_role, roles)}
                          </span>
                        )}

                        {/* 상태 배지 */}
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_CONFIG[task.status].className}`}
                        >
                          {STATUS_CONFIG[task.status].label}
                        </span>

                        {/* 삭제 버튼 / 확인 */}
                        <div className="flex items-center gap-2 shrink-0">
                          {confirmingDeleteId === task.id ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDeleteTask(task.id, task.title)}
                                disabled={deletingId === task.id}
                                className="text-xs font-medium text-red-600 hover:text-red-700 disabled:opacity-40 transition"
                              >
                                {deletingId === task.id ? '삭제 중...' : '삭제'}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingDeleteId(null)}
                                disabled={deletingId === task.id}
                                className="text-xs text-gray-400 hover:text-gray-600 disabled:opacity-40 transition"
                              >
                                취소
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingDeleteId(task.id)}
                              className="text-xs text-gray-300 hover:text-red-500 transition"
                            >
                              삭제
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

