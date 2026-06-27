'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { createAdminClient } from '@/lib/supabase/admin';
import { Button } from '@/components/ui/button';

interface ProjectInfo {
  id: string;
  name: string;
  deadline: string | null;
  team_size: number | null;
}

export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [isInvalid, setIsInvalid] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isJoining, setIsJoining] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    async function init() {
      // 1. admin 클라이언트로 token → 프로젝트 조회 (RLS 우회)
      const admin = createAdminClient();
      const { data: proj } = await admin
        .from('projects')
        .select('id, name, deadline, team_size')
        .eq('invite_token', token)
        .eq('invite_active', true)
        .single();

      if (!proj) {
        setIsInvalid(true);
        setIsLoading(false);
        return;
      }

      setProject(proj);

      // 2. 로그인 여부 확인 (일반 클라이언트)
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        setIsLoggedIn(true);

        // 3. 이미 멤버인지 확인
        const { data: existing } = await supabase
          .from('project_members')
          .select('id')
          .eq('project_id', proj.id)
          .eq('user_id', user.id)
          .single();

        if (existing) {
          router.replace(`/project/${proj.id}`);
          return;
        }
      }

      setIsLoading(false);
    }

    init();
  }, [token, router]);

  async function handleJoin() {
    if (!project) return;
    setIsJoining(true);

    try {
      if (!isLoggedIn) {
        // 로그인 안 됐으면 쿠키에 invite_token 저장 후 /login으로 이동
        await fetch('/api/join/init', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        window.location.href = `${window.location.origin}/login?redirect=/join/${token}`;
        return;
      }

      // 로그인 됐으면 project_members INSERT
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

  // ── 로딩 ──────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
        <p className="text-sm text-gray-400">초대 링크 확인 중...</p>
      </div>
    );
  }

  // ── 유효하지 않은 링크 ────────────────────────────────────────────────────
  if (isInvalid || !project) {
    return (
      <div className="w-full max-w-sm flex flex-col items-center gap-6 text-center">
        <span className="text-4xl">🔗</span>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">유효하지 않은 초대 링크입니다</h1>
          <p className="mt-2 text-sm text-gray-400">
            링크가 만료되었거나 잘못된 링크예요.
          </p>
        </div>
        <Button variant="outline" onClick={() => router.push('/')}>
          홈으로 이동
        </Button>
      </div>
    );
  }

  // ── 참여 화면 ─────────────────────────────────────────────────────────────
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
