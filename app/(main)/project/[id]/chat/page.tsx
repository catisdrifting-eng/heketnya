'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { ChatSummary } from '@/components/chat-summary';

// ─── Supabase 클라이언트: 모듈 스코프에서 한 번만 생성해 재사용 ─────────────
// (컴포넌트 본문/렌더마다 새 인스턴스를 만들면 매번 새 참조가 생겨
//  이를 의존성으로 사용하는 코드가 있을 경우 무한 루프의 원인이 될 수 있다)
const supabase = createClient();

// ─── 타입 ──────────────────────────────────────────────────────────────────

interface TeamMember {
  user_id: string;
  name: string;
  email: string;
}

interface ChatMessage {
  id: string;
  project_id: string;
  user_id: string;
  content: string;
  mentions: string[] | null;
  created_at: string;
}

// 입력창에 표시 중인 멘션 하나에 대한 매핑 정보.
// 입력창(textarea)에는 "@이름"만 보여주고, 실제 전송 시에는
// 이 매핑을 이용해 "@[이름](user_id)" 형식으로 치환한다.
interface MentionSpan {
  start: number; // input 문자열 내 '@' 시작 위치
  length: number; // "@이름" 텍스트 전체 길이 (공백 포함하지 않음)
  userId: string;
  name: string;
}

// ─── 멘션 파싱/렌더링 (메시지 목록 표시용) ─────────────────────────────────
// 메시지는 DB에 @[이름](user_id) 형태로 저장된다.
// 렌더링 시에는 이 패턴을 파싱해서 "@이름"만 보여주고 강조 스타일을 입힌다.

const MENTION_PATTERN = /@\[([^\]]+)\]\(([0-9a-fA-F-]+)\)/g;

function renderMessageContent(content: string) {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let key = 0;

  MENTION_PATTERN.lastIndex = 0;
  while ((match = MENTION_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push(content.slice(lastIndex, match.index));
    }
    const name = match[1];
    parts.push(
      <span
        key={`mention-${key++}`}
        className="rounded bg-blue-50 px-1 py-0.5 text-blue-700 font-medium"
      >
        @{name}
      </span>,
    );
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push(content.slice(lastIndex));
  }

  return parts;
}

// ─── 이니셜 아바타 ─────────────────────────────────────────────────────────

function InitialAvatar({ name }: { name: string }) {
  const initial = name.trim().charAt(0).toUpperCase() || '?';
  const colors = [
    'bg-blue-100 text-blue-700',
    'bg-purple-100 text-purple-700',
    'bg-green-100 text-green-700',
    'bg-orange-100 text-orange-700',
    'bg-pink-100 text-pink-700',
    'bg-teal-100 text-teal-700',
  ];
  const colorIdx =
    name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % colors.length;

  return (
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${colors[colorIdx]}`}
    >
      {initial}
    </div>
  );
}

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default function ChatPage() {
  const params = useParams<{ id: string }>();
  // useParams()는 동적 세그먼트가 catch-all이 아니면 string을 반환하지만,
  // 방어적으로 배열인 경우도 처리해 항상 string으로 정규화한다.
  const id = Array.isArray(params.id) ? params.id[0] : params.id;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [memberMap, setMemberMap] = useState<Record<string, TeamMember>>({});
  const [currentUserId, setCurrentUserId] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);

  // 멘션 자동완성 상태
  const [mentionQuery, setMentionQuery] = useState<string | null>(null); // null이면 자동완성 닫힘
  const [mentionStart, setMentionStart] = useState<number>(-1); // 입력창 내 '@' 위치
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);

  // 입력창에 현재 삽입되어 있는 멘션들의 위치 매핑
  // (표시는 "@이름"이지만 전송 시 "@[이름](user_id)"로 치환하기 위함)
  const mentionSpansRef = useRef<MentionSpan[]>([]);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isNearBottomRef = useRef(true);
  const prevMessageCountRef = useRef(0);

  // ── 초기 데이터 로드 ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled && user) setCurrentUserId(user.id);

      const [membersRes, messagesRes] = await Promise.all([
        supabase
          .from('project_members')
          .select('user_id, users(id, name, email)')
          .eq('project_id', id),
        supabase
          .from('messages')
          .select('id, project_id, user_id, content, mentions, created_at')
          .eq('project_id', id)
          .order('created_at', { ascending: true })
          .limit(50),
      ]);

      if (cancelled) return;

      if (membersRes.data) {
        const parsed: TeamMember[] = membersRes.data.map((row: any) => ({
          user_id: row.user_id,
          name: row.users?.name ?? row.users?.email ?? '알 수 없음',
          email: row.users?.email ?? '',
        }));
        setMembers(parsed);
        const map: Record<string, TeamMember> = {};
        parsed.forEach((m) => {
          map[m.user_id] = m;
        });
        setMemberMap(map);
      }

      if (messagesRes.data) {
        setMessages(messagesRes.data as ChatMessage[]);
      }

      setIsLoading(false);
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [id]);

  // 최초 로드 후 맨 아래로 스크롤
  useEffect(() => {
    if (!isLoading) {
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [isLoading]);

  // 메시지 개수가 늘어났을 때만 자동 스크롤 (내용 자체 변화에는 반응하지 않음)
  useEffect(() => {
    const prevCount = prevMessageCountRef.current;
    prevMessageCountRef.current = messages.length;

    if (messages.length > prevCount && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop = el.scrollHeight;
      });
    }
  }, [messages.length]);

  // 화면이 마운트될 때 읽음 처리
  useEffect(() => {
    supabase.rpc('mark_chat_read', { p_project_id: id }).then(() => {}, () => {});
  }, [id]);

  // ── Realtime 구독: 새 메시지 (id에만 의존, cleanup에서 반드시 정리) ───────
  useEffect(() => {
    const channel = supabase
      .channel(`messages-${id}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `project_id=eq.${id}`,
        },
        (payload) => {
          const newMsg = payload.new as ChatMessage;
          setMessages((prev) => {
            if (prev.some((m) => m.id === newMsg.id)) return prev;
            return [...prev, newMsg];
          });
          supabase.rpc('mark_chat_read', { p_project_id: id }).then(() => {}, () => {});
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [id]);


  // ── 스크롤 위치 추적 (맨 아래 근접 여부) ──────────────────────────────────
  // setState는 절대 호출하지 않고, ref만 갱신해서 렌더 트리거를 하지 않는다.
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    isNearBottomRef.current = distanceFromBottom < 120;
  }, []);

  // ── 멘션 자동완성: 팀원 필터링 ────────────────────────────────────────────
  const filteredMentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return members.filter((m) => m.name.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, members]);

  // ── 멘션 스팬 보정 헬퍼 ────────────────────────────────────────────────
  // 텍스트 변경(삽입/삭제) 이후, 기존에 기록해둔 멘션 스팬들이
  // 여전히 "@이름" 그대로 유지되고 있는지 확인하고, 위치를 보정하거나
  // 깨진 경우(부분 수정됨) 제거한다.
  function reconcileMentionSpans(newValue: string) {
    mentionSpansRef.current = mentionSpansRef.current.filter((span) => {
      const expected = `@${span.name}`;
      const actual = newValue.slice(span.start, span.start + span.length);
      return actual === expected;
    });
  }

  // ── 입력 변화 처리 (멘션 트리거 감지) ─────────────────────────────────────
  // 멘션 자동완성 상태 갱신은 반드시 이 onChange 핸들러 안에서만 일어난다.
  function handleInputChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    const cursorPos = e.target.selectionStart ?? value.length;

    reconcileMentionSpans(value);
    setInput(value);

    // 커서 앞 텍스트에서 마지막 '@' 위치 찾기
    const textBeforeCursor = value.slice(0, cursorPos);
    const atIndex = textBeforeCursor.lastIndexOf('@');

    if (atIndex === -1) {
      setMentionQuery(null);
      setMentionStart(-1);
      return;
    }

    const afterAt = textBeforeCursor.slice(atIndex + 1);
    // 공백/개행이 포함되면 멘션 입력 종료로 간주
    if (/\s/.test(afterAt)) {
      setMentionQuery(null);
      setMentionStart(-1);
      return;
    }

    setMentionQuery(afterAt);
    setMentionStart(atIndex);
    setActiveMentionIndex(0);
  }

  // ── 멘션 선택 ──────────────────────────────────────────────────────────
  // 입력창에는 "@이름"만 삽입하고, 실제 저장 형식과의 매핑은 ref로 관리한다.
  function selectMention(member: TeamMember) {
    if (mentionStart === -1) return;

    const cursorPos = textareaRef.current?.selectionStart ?? input.length;
    const before = input.slice(0, mentionStart);
    const after = input.slice(cursorPos);
    const displayText = `@${member.name}`;
    const insertedText = `${displayText} `;

    const newValue = `${before}${insertedText}${after}`;

    // before 길이 이후에 삽입되므로, before보다 뒤에 있던 기존 스팬들은
    // 삽입된 길이만큼 위치를 밀어줘야 한다.
    const insertedLength = insertedText.length;
    mentionSpansRef.current = mentionSpansRef.current
      .map((span) =>
        span.start >= mentionStart
          ? { ...span, start: span.start + insertedLength }
          : span,
      )
      .filter((span) => span.start + span.length <= before.length || span.start >= mentionStart + insertedLength);

    mentionSpansRef.current.push({
      start: mentionStart,
      length: displayText.length,
      userId: member.user_id,
      name: member.name,
    });

    setInput(newValue);
    setMentionQuery(null);
    setMentionStart(-1);

    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        const newCursorPos = before.length + insertedText.length;
        el.focus();
        el.setSelectionRange(newCursorPos, newCursorPos);
      }
    });
  }

  // ── 키보드 네비게이션 (자동완성 열려있을 때) ──────────────────────────────
  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionQuery !== null && filteredMentionCandidates.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveMentionIndex((i) => (i + 1) % filteredMentionCandidates.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveMentionIndex(
          (i) =>
            (i - 1 + filteredMentionCandidates.length) %
            filteredMentionCandidates.length,
        );
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        selectMention(filteredMentionCandidates[activeMentionIndex]);
        return;
      }
      if (e.key === 'Escape') {
        setMentionQuery(null);
        setMentionStart(-1);
        return;
      }
    }

    if (e.key === 'Enter' && !e.shiftKey && mentionQuery === null) {
      e.preventDefault();
      handleSend();
    }
  }

  // ── 입력창 표시 텍스트 → 저장용 텍스트 변환 ───────────────────────────────
  // mentionSpansRef에 남아있는(= 아직 부분 수정되지 않은) 멘션들만
  // "@[이름](user_id)" 형식으로 치환한다. 뒤에서부터 치환해야 인덱스가 안 밀린다.
  function buildStoredContent(value: string): { content: string; mentionIds: string[] } {
    const spans = [...mentionSpansRef.current].sort((a, b) => b.start - a.start);
    let result = value;
    const mentionIds: string[] = [];

    for (const span of spans) {
      const expected = `@${span.name}`;
      const actual = result.slice(span.start, span.start + span.length);
      if (actual !== expected) continue; // 깨진 스팬은 건너뜀

      const replacement = `@[${span.name}](${span.userId})`;
      result = result.slice(0, span.start) + replacement + result.slice(span.start + span.length);
      if (!mentionIds.includes(span.userId)) mentionIds.push(span.userId);
    }

    return { content: result, mentionIds };
  }

  // ── 메시지 전송 ───────────────────────────────────────────────────────────
  async function handleSend() {
    const trimmedDisplay = input.trim();
    if (!trimmedDisplay || isSending || !currentUserId) return;

    setIsSending(true);

    const { content: storedContent, mentionIds } = buildStoredContent(input);
    const trimmedStored = storedContent.trim();

    try {
      const { error } = await supabase.from('messages').insert({
        project_id: id,
        user_id: currentUserId,
        content: trimmedStored,
        mentions: mentionIds.length > 0 ? mentionIds : null,
      });

      if (!error) {
        setInput('');
        mentionSpansRef.current = [];
        isNearBottomRef.current = true;
      }
    } finally {
      setIsSending(false);
    }
  }

  // ── 작성자 이름 조회 헬퍼 ──────────────────────────────────────────────────
  function getAuthorName(userId: string) {
    return memberMap[userId]?.name ?? '알 수 없음';
  }

  function formatTime(iso: string) {
    return new Date(iso).toLocaleTimeString('ko-KR', {
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  // ─────────────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100dvh-14rem)] min-h-[24rem] flex-col">
      <ChatSummary projectId={id} />
      {/* 메시지 목록 */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto rounded-xl border border-gray-100 bg-gray-50/50 px-4 py-4"
      >
        {messages.length === 0 ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-gray-400">
              아직 대화가 없어요. 첫 메시지를 남겨보세요.
            </p>
          </div>
        ) : (

          <div className="flex flex-col gap-3">
            {messages.map((msg) => {
              const isMine = msg.user_id === currentUserId;
              return (
                <div
                  key={msg.id}
                  className={`flex items-end gap-2 ${
                    isMine ? 'flex-row-reverse' : 'flex-row'
                  }`}
                >
                  {!isMine && <InitialAvatar name={getAuthorName(msg.user_id)} />}

                  <div
                    className={`flex max-w-[75%] flex-col gap-1 ${
                      isMine ? 'items-end' : 'items-start'
                    }`}
                  >
                    {!isMine && (
                      <span className="text-xs font-medium text-gray-500">
                        {getAuthorName(msg.user_id)}
                      </span>
                    )}
                    <div
                      className={`whitespace-pre-wrap break-words rounded-xl px-3.5 py-2 text-sm leading-relaxed ${
                        isMine
                          ? 'bg-gray-900 text-white'
                          : 'border border-gray-200 bg-white text-gray-900'
                      }`}
                    >
                      {renderMessageContent(msg.content)}
                    </div>
                    <span className="text-[10px] text-gray-400">
                      {formatTime(msg.created_at)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* 입력 영역 */}
      <div className="sticky bottom-0 mt-3 flex flex-col gap-2 border-t border-gray-100 bg-white pt-3">
        {/* 멘션 자동완성 드롭다운 */}
        {mentionQuery !== null && filteredMentionCandidates.length > 0 && (
          <div className="flex flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
            {filteredMentionCandidates.map((m, idx) => (
              <button
                key={m.user_id}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  selectMention(m);
                }}
                className={`flex items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  idx === activeMentionIndex
                    ? 'bg-gray-100 text-gray-900'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <InitialAvatar name={m.name} />
                <span className="truncate">{m.name}</span>
                <span className="ml-auto truncate text-xs text-gray-400">
                  {m.email}
                </span>
              </button>
            ))}
          </div>
        )}

        <div className="flex items-end gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="메시지를 입력하세요... (@ 로 팀원 멘션)"
            rows={1}
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-gray-200 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 outline-none transition focus:border-gray-400 focus:bg-white"
          />
          <button
            type="button"
            onClick={handleSend}
            disabled={!input.trim() || isSending}
            className="shrink-0 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-gray-800 disabled:opacity-40"
          >
            전송
          </button>
        </div>
      </div>
    </div>
  );
}
