'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

interface ProjectInfo {
  id: string;
  name: string;
  deadline: string | null;
  team_size: number | null;
}

interface Props {
  token: string;
  project: ProjectInfo;
}

export default function JoinActions({ token, project }: Props) {
  const router = useRouter();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const [isJoining, setIsJoining] = useState(false);

  // 로그인 여부 확인 + 이미 멤버인지 확인
  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setIsLoggedIn(true);

        // 이미 멤버인지 확인
        const { data: existing } = await supabase
          .from('project_members')
          .select('id')
          .eq('project_id', project.id)
          .eq('user_id', user.id)
          .single();

        if (existing) {
          router.replace(`/project/${project.id}`);
          return;
        }
      }

      setIsChecking(false);
    }

    init();
  }, [project.id, router]);

  async function handleJoin() {
    setIsJoining(true);

    try {
      if (!isLoggedIn) {
        // 미로그인: 쿠키에 token 저장 후 로그인 페이지로
        await fetch('/api/join/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        window.location.href = `${window.location.origin}/login?redirect=/join/${token}`;
        return;
      }

      // 로그인: project_members INSERT
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        window.location.href = `${window.location.origin}/login?redirect=/join/${token}`;
        return;
      }

      const { error } = await supabase.from('project_members').insert({
        project_id: project.id,
        user_id: user.id,
      });

      if (error) {
        alert('프로젝트 참여에 실패했어요.');
        return;
      }

      router.push(`/project/${project.id}/role`);
    } finally {
      setIsJoining(false);
    }
  }

  if (isChecking) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
        <p className="text-sm text-gray-400">확인 중...</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm flex flex-col gap-8">
      {/* 헤더 */}
      <div className="flex flex-col items-center gap-2 text-center">
        <span className="text-3xl">👋</span>
        <h1 className="text-xl font-semibold text-gray-900">프로젝트에 초대받았어요</h1>
        <p className="text-sm text-gray-400">아래 프로젝트에 참여할 수 있어요.</p>
      </div>

      {/* 프로젝트 정보 카드 */}
      <div className="rounded-xl border border-gray-200 bg-gray-50 px-5 py-5 flex flex-col gap-3">
        <p className="text-base font-semibold text-gray-900">{project.name}</p>

        <div className="flex flex-col gap-1.5">
          {project.team_size && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="text-gray-400">👥</span>
              <span>예상 팀원 {project.team_size}명</span>
            </div>
          )}
          {project.deadline && (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              <span className="text-gray-400">📅</span>
              <span>
                마감일{' '}
                {new Date(project.deadline).toLocaleDateString('ko-KR', {
                  year: 'numeric',
                  month: 'long',
                  day: 'numeric',
                })}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 참여 버튼 */}
      <Button size="lg" className="w-full" disabled={isJoining} onClick={handleJoin}>
        {isJoining
          ? '참여 중...'
          : isLoggedIn
            ? '이 프로젝트에 참여하기'
            : '로그인 후 참여하기'}
      </Button>

      {!isLoggedIn && (
        <p className="text-xs text-gray-400 text-center -mt-4">
          Google 계정으로 로그인하면 자동으로 참여됩니다.
        </p>
      )}
    </div>
  );
}
