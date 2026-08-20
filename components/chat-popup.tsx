'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const supabase = createClient();

interface ChatMessage {
  id: string;
  project_id: string;
  user_id: string;
  content: string;
  mentions: string[] | null;
  created_at: string;
}

interface TeamMember {
  user_id: string;
  name: string;
}

const MENTION_PATTERN = /@\[([^\]]+)\]\([^)]+\)/g;

function renderMessageContent(content: string) {
  return content.replace(MENTION_PATTERN, '@$1');
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString('ko-KR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function ChatPopup({
  projectId,
  currentUserId,
  onOpened,
}: {
  projectId: string;
  currentUserId: string | null;
  onOpened: () => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, TeamMember>>({});
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // 패널이 열릴 때 초기 데이터 로드 + 읽음 처리
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;

    async function load() {
      setIsLoading(true);

      const [membersRes, messagesRes] = await Promise.all([
        supabase
          .from('project_members')
          .select('user_id, users(id, name, email)')
          .eq('project_id', projectId),
        supabase
          .from('messages')
          .select('id, project_id, user_id, content, mentions, created_at')
          .eq('project_id', projectId)
          .order('created_at', { ascending: false })
          .limit(50),
      ]);

      if (cancelled) return;

      if (membersRes.data) {
        const map: Record<string, TeamMember> = {};
        membersRes.data.forEach((row: any) => {
          map[row.user_id] = {
            user_id: row.user_id,
            name: row.users?.name ?? row.users?.email ?? '알 수 없음',
          };
        });
        setMemberMap(map);
      }

      if (messagesRes.data) {
        setMessages((messagesRes.data as ChatMessage[]).slice().reverse());
      }

      setIsLoading(false);

      supabase.rpc('mark_chat_read', { p_project_id: projectId }).then(
        () => {},
        () => {},
      );

      onOpened();
    }

    load();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, projectId]);

  // 패널이 열려 있는 동안에만 Realtime 구독
  useEffect(() => {
    if (!isOpen) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    channel = supabase
      .channel(`chat-popup-${projectId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `project_id=eq.${projectId}`,
        },
        (payload) => {
          if (cancelled) return;
          const newMsg = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          supabase.rpc('mark_chat_read', { p_project_id: projectId }).then(
            () => {},
            () => {},
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
    };
  }, [isOpen, projectId]);

  // 새 메시지 오거나 패널이 열릴 때 맨 아래로 스크롤
  useEffect(() => {
    if (!isOpen) return;
    requestAnimationFrame(() => {
      const el = scrollContainerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  }, [isOpen, messages.length]);

  function getAuthorName(userId: string) {
    return memberMap[userId]?.name ?? '알 수 없음';
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || isSending || !currentUserId) return;

    setIsSending(true);
    setSendError(null);

    try {
      const { error } = await supabase.from('messages').insert({
        project_id: projectId,
        user_id: currentUserId,
        content: trimmed,
        mentions: [],
      });

      if (error) {
        setSendError('전송에 실패했어요. 다시 시도해주세요.');
      } else {
        setInput('');
      }
    } catch {
      setSendError('전송에 실패했어요. 다시 시도해주세요.');
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {isOpen && (
        <div
          className="fixed bottom-24 right-6 z-40 flex w-[360px] max-sm:left-4 max-sm:right-4 max-sm:w-auto h-[480px] max-sm:h-[70vh] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
        >
          {/* 헤더 */}
          <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
            <span className="text-sm font-semibold text-gray-900">팀 채팅</span>
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="text-gray-400 hover:text-gray-700"
              aria-label="닫기"
            >
              ×
            </button>
          </div>

          {/* 메시지 목록 */}
          <div
            ref={scrollContainerRef}
            className="flex-1 overflow-y-auto bg-gray-50/50 px-3 py-3"
          >
            {isLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <p className="text-xs text-gray-400">아직 대화가 없어요.</p>
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                {messages.map((msg) => {
                  const isMine = msg.user_id === currentUserId;
                  return (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        isMine ? 'items-end' : 'items-start'
                      }`}
                    >
                      {!isMine && (
                        <span className="text-[10px] font-medium text-gray-500">
                          {getAuthorName(msg.user_id)}
                        </span>
                      )}
                      <div
                        className={`max-w-[80%] whitespace-pre-wrap break-words rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${
                          isMine
                            ? 'bg-gray-900 text-white'
                            : 'border border-gray-200 bg-white text-gray-900'
                        }`}
                      >
                        {renderMessageContent(msg.content)}
                      </div>
                      <span className="text-[9px] text-gray-400">
                        {formatTime(msg.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 입력 영역 */}
          <div className="border-t border-gray-100 px-3 py-2.5">
            {sendError && (
              <p className="mb-1.5 text-[10px] text-red-500">{sendError}</p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="메시지를 입력하세요"
                className="flex-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:bg-white"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={!input.trim() || isSending}
                className="shrink-0 rounded-lg bg-gray-900 px-3 py-2 text-xs font-medium text-white transition hover:bg-gray-800 disabled:opacity-40"
              >
                보내기
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 플로팅 버튼 */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="fixed bottom-6 right-6 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white shadow-lg transition hover:bg-gray-800"
      >
        채팅
      </button>
    </>
  );
}
