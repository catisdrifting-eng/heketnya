'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import type { RolePreference } from '@/types';

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface RoadmapTask {
  id: string; // 클라이언트 임시 ID
  title: string;
  description: string | null;
  dueDate: string;
  suggestedRole: RolePreference;
  sortOrder: number;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ─── 역할 배지 색상 ────────────────────────────────────────────────────────

const ROLE_COLORS: Record<RolePreference, string> = {
  research: 'bg-blue-100 text-blue-700',
  writing: 'bg-purple-100 text-purple-700',
  presentation: 'bg-orange-100 text-orange-700',
  coding: 'bg-green-100 text-green-700',
  any: 'bg-gray-100 text-gray-600',
};

const ROLE_LABELS: Record<RolePreference, string> = {
  research: '리서치',
  writing: '작성',
  presentation: '발표',
  coding: '개발',
  any: '공통',
};

const ROLE_OPTIONS: RolePreference[] = [
  'research',
  'writing',
  'presentation',
  'coding',
  'any',
];

// ─── 태스크 카드 ───────────────────────────────────────────────────────────

function TaskCard({
  task,
  onChange,
  onDelete,
}: {
  task: RoadmapTask;
  onChange: (patch: Partial<RoadmapTask>) => void;
  onDelete: () => void;
}) {
  return (
    <div className="group relative flex flex-col gap-3 rounded-xl border border-gray-200 bg-white p-4 shadow-sm transition hover:border-gray-300">
      {/* 삭제 버튼 */}
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-3 top-3 hidden rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600 group-hover:flex"
        aria-label="태스크 삭제"
      >
        ✕
      </button>

      {/* 제목 */}
      <input
        type="text"
        value={task.title}
        onChange={(e) => onChange({ title: e.target.value })}
        placeholder="태스크 제목"
        className="w-full text-sm font-medium text-gray-900 placeholder:text-gray-400 outline-none bg-transparent border-b border-transparent focus:border-gray-200 pb-0.5 transition pr-6"
      />

      {/* 설명 */}
      <textarea
        value={task.description ?? ''}
        onChange={(e) =>
          onChange({ description: e.target.value || null })
        }
        placeholder="설명 (선택)"
        rows={2}
        className="w-full resize-none text-xs text-gray-500 placeholder:text-gray-300 outline-none bg-transparent leading-relaxed"
      />

      {/* 하단: 마감일 + 역할 배지 */}
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="date"
          value={task.dueDate}
          onChange={(e) => onChange({ dueDate: e.target.value })}
          className="text-xs text-gray-500 outline-none bg-transparent border border-gray-200 rounded-md px-2 py-1 focus:border-gray-400 transition"
        />

        <select
          value={task.suggestedRole}
          onChange={(e) =>
            onChange({ suggestedRole: e.target.value as RolePreference })
          }
          className={`text-xs font-medium rounded-full px-2.5 py-1 border-0 outline-none cursor-pointer ${ROLE_COLORS[task.suggestedRole]}`}
        >
          {ROLE_OPTIONS.map((role) => (
            <option key={role} value={role}>
              {ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default function RoadmapPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [tasks, setTasks] = useState<RoadmapTask[]>([]);
  const [isConfirming, setIsConfirming] = useState(false);
  const [projectMeta, setProjectMeta] = useState<{ deadline: string; team_size: number } | null>(null);

  // 채팅
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // ── sessionStorage에서 tasks + 프로젝트 메타 로드 ────────────────────────
  useEffect(() => {
    const raw = sessionStorage.getItem(`roadmap-${id}`);
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw) as Omit<RoadmapTask, 'id'>[];
      setTasks(
        parsed.map((t, i) => ({
          ...t,
          id: `task-${i}-${Date.now()}`,
        })),
      );
    } catch {
      // 파싱 실패 시 무시
    }

    // 프로젝트 메타 로드 (deadline, team_size)
    const metaRaw = sessionStorage.getItem(`roadmap-meta-${id}`);
    if (metaRaw) {
      try {
        setProjectMeta(JSON.parse(metaRaw));
      } catch {
        // 무시
      }
    }
  }, [id]);

  // 채팅 스크롤
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  // ── 태스크 수정 ──────────────────────────────────────────────────────────
  function updateTask(taskId: string, patch: Partial<RoadmapTask>) {
    setTasks((prev) =>
      prev.map((t) => (t.id === taskId ? { ...t, ...patch } : t)),
    );
  }

  function deleteTask(taskId: string) {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  }

  function addTask() {
    const newTask: RoadmapTask = {
      id: `task-new-${Date.now()}`,
      title: '',
      description: null,
      dueDate: '',
      suggestedRole: 'any',
      sortOrder: tasks.length + 1,
    };
    setTasks((prev) => [...prev, newTask]);
  }

  // ── 확정하기 ─────────────────────────────────────────────────────────────
  async function handleConfirm() {
    setIsConfirming(true);
    try {
      const supabase = createClient();

      // a. tasks BULK INSERT
      const { error: tasksError } = await supabase.from('tasks').insert(
        tasks.map((t, i) => ({
          project_id: id,
          title: t.title,
          description: t.description,
          due_date: t.dueDate || null,
          suggested_role: t.suggestedRole,
          sort_order: i + 1,
          status: 'pending',
        })),
      );

      if (tasksError) {
        alert('태스크 저장에 실패했어요.');
        return;
      }

      // b. project status → 'selecting', roadmap_confirmed_at → now()
      const { error: projectError } = await supabase
        .from('projects')
        .update({
          status: 'selecting',
          roadmap_confirmed_at: new Date().toISOString(),
        })
        .eq('id', id);

      if (projectError) {
        alert('프로젝트 상태 업데이트에 실패했어요.');
        return;
      }

      // c. sessionStorage 정리
      sessionStorage.removeItem(`roadmap-${id}`);

      // d. 초대 페이지로 이동
      router.push(`/project/${id}/invite`);
    } finally {
      setIsConfirming(false);
    }
  }

  // ── AI 채팅 전송 ─────────────────────────────────────────────────────────
  async function handleChatSend() {
    const message = chatInput.trim();
    if (!message || isChatLoading) return;

    setChatMessages((prev) => [...prev, { role: 'user', content: message }]);
    setChatInput('');
    setIsChatLoading(true);

    try {
      const res = await fetch('/api/ai/chat-modify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId: id,
          currentTasks: tasks.map((t) => ({
            title: t.title,
            description: t.description,
            dueDate: t.dueDate,
            suggestedRole: t.suggestedRole,
            sortOrder: t.sortOrder,
          })),
          userMessage: message,
          deadline: projectMeta?.deadline ?? '',
          teamSize: projectMeta?.team_size ?? 1,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: data.error ?? '수정에 실패했어요.' },
        ]);
        return;
      }

      // 태스크 목록 업데이트 (임시 id 재부여)
      const updatedTasks = (data.tasks as Omit<RoadmapTask, 'id'>[]).map(
        (t, i) => ({ ...t, id: `task-${i}-${Date.now()}` }),
      );
      setTasks(updatedTasks);

      // AI 답변 메시지 추가
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.summary ?? '태스크를 수정했어요.' },
      ]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '수정에 실패했어요. 다시 시도해주세요.' },
      ]);
    } finally {
      setIsChatLoading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">로드맵 확인 및 수정</h1>
        <p className="mt-1 text-sm text-gray-400">
          태스크를 검토하고 필요하면 수정하세요
        </p>
      </div>

      {/* 본문: 태스크 목록 + 채팅 */}
      <div className="flex gap-6 items-start">
        {/* ── 왼쪽: 태스크 목록 (2/3) ── */}
        <div className="flex-[2] flex flex-col gap-3 min-w-0">
          {tasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
              <p className="text-sm text-gray-400">태스크가 없어요.</p>
            </div>
          ) : (
            tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onChange={(patch) => updateTask(task.id, patch)}
                onDelete={() => deleteTask(task.id)}
              />
            ))
          )}

          {/* 하단 버튼 */}
          <div className="flex gap-2 pt-2">
            <Button variant="outline" size="sm" onClick={addTask}>
              + 태스크 추가
            </Button>
            <Button
              size="sm"
              disabled={tasks.length === 0 || isConfirming}
              onClick={handleConfirm}
              className="ml-auto"
            >
              {isConfirming ? '저장 중...' : '확정하기'}
            </Button>
          </div>
        </div>

        {/* ── 오른쪽: AI 채팅창 (1/3) ── */}
        <div className="flex-[1] flex flex-col gap-0 rounded-xl border border-gray-200 bg-white overflow-hidden min-w-0 sticky top-6">
          {/* 채팅 헤더 */}
          <div className="border-b border-gray-100 px-4 py-3">
            <p className="text-xs font-semibold text-gray-700">AI 수정 도우미</p>
            <p className="text-xs text-gray-400 mt-0.5">태스크 수정을 요청해보세요</p>
          </div>

          {/* 메시지 목록 */}
          <div className="flex flex-col gap-3 px-4 py-4 h-72 overflow-y-auto">
            {chatMessages.length === 0 ? (
              <p className="text-xs text-gray-300 text-center mt-8">
                아직 메시지가 없어요
              </p>
            ) : (
              chatMessages.map((msg, i) => (
                <div
                  key={i}
                  className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-gray-900 text-white'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {msg.content}
                  </div>
                </div>
              ))
            )}
            <div ref={chatEndRef} />
          </div>

          {/* 입력창 */}
          <div className="border-t border-gray-100 p-3 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleChatSend();
                }
              }}
              placeholder="예: 3번 태스크를 두 개로 쪼개줘"
              disabled={isChatLoading}
              className="flex-1 text-xs text-gray-900 placeholder:text-gray-300 outline-none bg-transparent"
            />
            <button
              type="button"
              onClick={handleChatSend}
              disabled={!chatInput.trim() || isChatLoading}
              className="text-xs font-medium text-gray-500 hover:text-gray-900 disabled:opacity-30 transition"
            >
              전송
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
