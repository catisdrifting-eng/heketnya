'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getRoleLabel, getRoleColor } from '@/lib/roles';
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
  const { id } = useParams<{ id: string }>();
  const [tasks, setTasks] = useState<DashboardTask[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // ── 초기 데이터 로드 ──────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      const supabase = createClient();

      const [tasksRes, membersRes, projectRes] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, status, assignee_id, due_date, suggested_role')
          .eq('project_id', id)
          .order('sort_order', { ascending: true }),
        supabase
          .from('project_members')
          .select('user_id, users(id, name, email, avatar_url)')
          .eq('project_id', id),
        supabase
          .from('projects')
          .select('custom_roles')
          .eq('id', id)
          .single(),
      ]);

      if (tasksRes.data) setTasks(tasksRes.data as DashboardTask[]);
      if (projectRes.data?.custom_roles) {
        setRoles(projectRes.data.custom_roles as Role[]);
      }

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
    }

    load();
  }, [id]);

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
  const overallPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

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
      {/* ── 전체 진행률 ─────────────────────────────────────────────────── */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">전체 진행률</h2>
          <span className="text-sm font-semibold text-gray-700">{overallPct}%</span>
        </div>
        <ProgressBar value={overallPct} />
        <p className="text-xs text-gray-400">
          전체 {totalCount}개 태스크 중{' '}
          <span className="font-medium text-gray-600">{completedCount}개</span> 완료
        </p>
      </section>

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
                          <span className="text-xs text-gray-500 hidden sm:block">
                            {getMemberName(task.assignee_id)}
                          </span>
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
