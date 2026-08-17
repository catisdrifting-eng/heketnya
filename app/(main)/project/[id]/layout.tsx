'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

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
  const [hasUnread, setHasUnread] = useState(false);


  const chatHref = `/project/${id}/chat`;
  const isChatActive = pathname === chatHref;

  const tabs = [
    { label: '프로젝트 홈', href: `/project/${id}` },
    { label: '대시보드', href: `/project/${id}/dashboard` },
    { label: '내 체크리스트', href: `/project/${id}/checklist` },
    { label: '채팅', href: chatHref },
  ];

  // 채팅 탭에 들어가 있으면 안읽음 표시를 끔
  useEffect(() => {
    if (isChatActive) {
      setHasUnread(false);
    }
  }, [isChatActive]);

  // 채팅 탭 밖에 있는 동안 새 메시지가 오면 안읽음 표시를 켬
  const isChatActiveRef = useRef(isChatActive);
  useEffect(() => {
    isChatActiveRef.current = isChatActive;
  }, [isChatActive]);

  useEffect(() => {
    // 채널 구독이 실패(CHANNEL_ERROR/TIMED_OUT/CLOSED)했을 때 조용히
    // 죽어있지 않도록, 짧은 지연 후 재구독을 시도한다.
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function subscribe() {
      if (cancelled) return;

      console.log('[unread-debug] effect start, id =', id);

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
            console.log('[unread-debug] INSERT event received', payload, 'isChatActive=', isChatActiveRef.current);
            if (!isChatActiveRef.current) {
              setHasUnread(true);
            }
          },
        )
        .subscribe((status) => {
          console.log('[unread-debug] subscribe status =', status);

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
      console.log('[unread-debug] effect cleanup, id =', id);
      if (retryTimer) clearTimeout(retryTimer);
      if (channel) supabase.removeChannel(channel);
    };
  }, [id]);



  return (
    <div className="flex flex-col gap-0">
      {/* 탭 네비게이션 */}
      <nav className="flex gap-0 border-b border-gray-100 mb-8">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          const isChatTab = tab.href === chatHref;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`relative px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                isActive
                  ? 'border-gray-900 text-gray-900'
                  : 'border-transparent text-gray-400 hover:text-gray-700'
              }`}
            >
              {tab.label}
              {isChatTab && hasUnread && (
                <span className="absolute right-1 top-1.5 h-2 w-2 rounded-full bg-red-500" />
              )}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
