'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import type { RolePreference } from '@/types';

// ─── 역할 카드 데이터 ──────────────────────────────────────────────────────

const ROLES: {
  value: RolePreference;
  label: string;
  desc: string;
}[] = [
  { value: 'research', label: '리서치', desc: '자료 조사, 시장 분석' },
  { value: 'writing', label: '글쓰기', desc: '보고서, 문서 작성' },
  { value: 'presentation', label: '발표', desc: '발표 자료, 시연' },
  { value: 'coding', label: '개발', desc: '코딩, 기술 구현' },
  { value: 'any', label: '아무거나', desc: '필요한 거 다' },
];

// ─── 메인 페이지 ───────────────────────────────────────────────────────────

export default function RolePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [selected, setSelected] = useState<RolePreference | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleNext() {
    if (!selected) return;
    setIsSaving(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        router.push('/login');
        return;
      }

      const { error } = await supabase
        .from('project_members')
        .update({ role_preference: selected })
        .eq('project_id', id)
        .eq('user_id', user.id);

      if (error) {
        alert('역할 저장에 실패했어요.');
        return;
      }

      router.push(`/project/${id}/select`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-8">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-semibold text-gray-900">어떤 역할을 맡을까요?</h1>
        <p className="mt-1 text-sm text-gray-400">
          프로젝트에서 주로 담당할 역할을 선택해주세요.
        </p>
      </div>

      {/* 역할 카드 목록 */}
      <div className="flex flex-col gap-3">
        {ROLES.map(({ value, label, desc }) => (
          <button
            key={value}
            type="button"
            onClick={() => setSelected(value)}
            className={`flex items-center gap-4 rounded-xl border-2 px-5 py-4 text-left transition-all ${
              selected === value
                ? 'border-black bg-gray-50 ring-2 ring-black ring-offset-1'
                : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
            }`}
          >
            <div className="flex flex-col min-w-0">
              <span className="text-sm font-semibold text-gray-900">{label}</span>
              <span className="text-xs text-gray-400 mt-0.5">{desc}</span>
            </div>

            {/* 선택 표시 */}
            <div
              className={`ml-auto h-4 w-4 shrink-0 rounded-full border-2 transition-colors ${
                selected === value
                  ? 'border-black bg-black'
                  : 'border-gray-300'
              }`}
            />
          </button>
        ))}
      </div>

      {/* 다음 버튼 */}
      <Button
        size="lg"
        className="w-full"
        disabled={!selected || isSaving}
        onClick={handleNext}
      >
        {isSaving ? '저장 중...' : '다음'}
      </Button>
    </div>
  );
}
