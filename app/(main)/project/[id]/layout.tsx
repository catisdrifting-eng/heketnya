'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import ChatPopup from '@/components/chat-popup';


// 컴포넌트 본문/렌더마다 새 인스턴스를 만들지 않도록 모듈 스코프에서 한 번만 생성
const supabase = createClient();

export default function ProjectLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const chatHref = `/project/${id}/chat`;
  const isChatActive = pathname === chatHref;

  const tabs = [
    { label: '프로젝트 홈', href: `/project/${id}` },
    { label: '대시보드', href: `/project/${id}/dashboard` },
    { label: '내 체크리스트', href: `/project/${id}/checklist` },
    { label: '채팅', href: chatHref },
    { label: '파일', href: `/project/${id}/files` },
  ];

  // 채팅 탭에 들어가 있으면 안읽음 개수를 0으로 만듦
  useEffect(() => {
    if (isChatActive) {
      setUnreadCount(0);
    }
  }, [isChatActive]);

  // 경로가 실제로 바뀌면(전환이 끝나면) 눌림 표시를 해제
  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);


  // 채팅 탭 밖에 있는 동안 새 메시지가 오면 안읽음 개수를 늘림
  const isChatActiveRef = useRef(isChatActive);
  useEffect(() => {
    isChatActiveRef.current = isChatActive;
  }, [isChatActive]);

  const currentUserIdRef = useRef<string>('');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);


  // 화면이 뜰 때 안 읽은 메시지 개수를 계산
  useEffect(() => {
    let cancelled = false;

    async function loadUnreadCount() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled || !user) return;
      currentUserIdRef.current = user.id;
      setCurrentUserId(user.id);


      const { data: memberRow } = await supabase
        .from('project_members')
        .select('last_read_at')
        .eq('project_id', id)
        .eq('user_id', user.id)
        .maybeSingle();

      if (cancelled) return;

      const lastReadAt = memberRow?.last_read_at ?? null;

      let query = supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', id)
        .neq('user_id', user.id);

      if (lastReadAt) {
        query = query.gt('created_at', lastReadAt);
      }

      const { count } = await query;

      if (!cancelled) {
        setUnreadCount(count ?? 0);
      }
    }

    loadUnreadCount();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    // 채널 구독이 실패(CHANNEL_ERROR/TIMED_OUT/CLOSED)했을 때 조용히
    // 죽어있지 않도록, 짧은 지연 후 재구독을 시도한다.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function subscribe() {
      if (cancelled) return;
      if (channel) {
        supabase.removeChannel(channel);
        channel = null;
      }

      channel = supabase
        .channel(`messages-unread-${id}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `project_id=eq.${id}`,
          },
          (payload) => {
            const newMsg = payload.new as { user_id?: string };
            if (
              !isChatActiveRef.current &&
              newMsg?.user_id !== currentUserIdRef.current
            ) {
              setUnreadCount((prev) => prev + 1);
            }
          },
        )
        .subscribe((status) => {

          if (
            !cancelled &&
            (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED')
          ) {
            // 이전 채널을 정리하고 잠시 후 재구독
            if (channel) {
              supabase.removeChannel(channel);
              channel = null;
            }
            retryTimer = setTimeout(() => {
              subscribe();
            }, 2000);
          }
        });
    }

    subscribe();

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [id]);

  return (
    <div className="flex flex-col gap-0 px-4 sm:px-0">
      {/* 내 프로젝트로 돌아가기 */}
      <Link
        href="/dashboard"
        className="mb-2 inline-block w-fit text-xs text-gray-400 hover:text-gray-600"
      >
        ← 내 프로젝트
      </Link>

      {/* 탭 네비게이션 */}
      <nav className="flex flex-nowrap items-center gap-1 overflow-x-auto border-b border-gray-100 mb-8 px-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">

        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          const isPending = pendingHref !== null && pendingHref === tab.href && pathname !== tab.href;
          const isChatTab = tab.href === chatHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              onClick={() => setPendingHref(tab.href)}
              className={`relative shrink-0 whitespace-nowrap px-4 py-2.5 text-sm font-medium border-b-2 transition-colors active:opacity-60 ${
                isActive || isPending
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {isPending && (
                <span className="ml-1 inline-flex gap-0.5 align-middle">
                  <span className="h-1 w-1 rounded-full bg-gray-400 animate-pulse" />
                  <span className="h-1 w-1 rounded-full bg-gray-400 animate-pulse [animation-delay:150ms]" />
                  <span className="h-1 w-1 rounded-full bg-gray-400 animate-pulse [animation-delay:300ms]" />
                </span>
              )}
              {isChatTab && unreadCount > 0 && (
                <span className="absolute right-0.5 top-1 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}

            </Link>
          );
        })}
      </nav>

      {children}


      {!isChatActive && (
        <ChatPopup
          projectId={id}
          currentUserId={currentUserId}
          onOpened={() => setUnreadCount(0)}
        />
      )}
    </div>
  );
}

