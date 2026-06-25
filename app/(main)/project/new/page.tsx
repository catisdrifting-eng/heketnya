'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { createClient } from '@/lib/supabase/client';
import type { ProjectType } from '@/types';

// ─── 폼 상태 타입 ──────────────────────────────────────────────────────────

interface FormData {
  type: ProjectType | null;
  customType: string;
  name: string;
  deadline: string;
  teamSize: string;
  description: string;
}

// ─── 프로젝트 유형 카드 데이터 ─────────────────────────────────────────────

const PROJECT_TYPES: { type: ProjectType; label: string; desc: string }[] = [
  { type: 'school', label: '조별과제', desc: '수업 팀 프로젝트' },
  { type: 'startup', label: '스타트업', desc: '창업 / 사이드 프로젝트' },
  { type: 'thesis', label: '논문 / 연구', desc: '학술 연구 프로젝트' },
  { type: 'other', label: '기타', desc: '직접 입력' },
];

// ─── 진행률 표시 ───────────────────────────────────────────────────────────

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-3 mb-8">
      <div className="flex gap-1.5">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1 w-8 rounded-full transition-colors ${
              i < current ? 'bg-gray-900' : 'bg-gray-200'
            }`}
          />
        ))}
      </div>
      <span className="text-xs text-gray-400">
        {current} / {total}
      </span>
    </div>
  );
}

// ─── Step 1: 프로젝트 유형 선택 ────────────────────────────────────────────

function Step1({
  data,
  onChange,
  onNext,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">어떤 프로젝트인가요?</h2>
        <p className="mt-1 text-sm text-gray-400">프로젝트 유형을 선택해주세요.</p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {PROJECT_TYPES.map(({ type, label, desc }) => (
          <button
            key={type}
            type="button"
            onClick={() => onChange({ type, customType: type !== 'other' ? '' : data.customType })}
            className={`flex flex-col items-start gap-2 rounded-xl border-2 p-5 text-left transition-all ${
              data.type === type
                ? 'border-black bg-gray-50 ring-2 ring-black ring-offset-1'
                : 'border-gray-200 hover:border-gray-400 hover:bg-gray-50'
            }`}
          >
            <span className="text-sm font-semibold text-gray-900">{label}</span>
            <span className="text-xs text-gray-400 leading-relaxed">{desc}</span>
          </button>
        ))}
      </div>

      {/* 기타 선택 시 텍스트 입력 */}
      {data.type === 'other' && (
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-600">
            프로젝트 유형을 직접 입력해주세요
          </label>
          <input
            type="text"
            value={data.customType}
            onChange={(e) => onChange({ customType: e.target.value })}
            placeholder="예: 동아리 활동, 해커톤 등"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition"
          />
        </div>
      )}

      <Button
        size="lg"
        className="w-full"
        disabled={
          !data.type || (data.type === 'other' && !data.customType.trim())
        }
        onClick={onNext}
      >
        다음
      </Button>
    </div>
  );
}

// ─── Step 2: 기본 정보 입력 ────────────────────────────────────────────────

function Step2({
  data,
  onChange,
  onNext,
  onBack,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onNext: () => void;
  onBack: () => void;
}) {
  const isValid =
    data.name.trim() &&
    data.deadline &&
    Number(data.teamSize) >= 2 &&
    Number(data.teamSize) <= 20;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">기본 정보를 입력해주세요</h2>
        <p className="mt-1 text-sm text-gray-400">프로젝트의 기본 정보를 알려주세요.</p>
      </div>

      <div className="flex flex-col gap-4">
        {/* 프로젝트 이름 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-600">
            프로젝트 이름 <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={data.name}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="예: 캡스톤 디자인 팀 프로젝트"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition"
          />
        </div>

        {/* 마감일 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-600">
            마감일 <span className="text-red-400">*</span>
          </label>
          <input
            type="date"
            value={data.deadline}
            onChange={(e) => onChange({ deadline: e.target.value })}
            min={new Date().toISOString().split('T')[0]}
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition"
          />
        </div>

        {/* 예상 팀원 수 */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-gray-600">
            예상 팀원 수 <span className="text-red-400">*</span>
          </label>
          <input
            type="number"
            value={data.teamSize}
            onChange={(e) => onChange({ teamSize: e.target.value })}
            min={2}
            max={20}
            placeholder="2 ~ 20"
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition"
          />
          {data.teamSize &&
            (Number(data.teamSize) < 2 || Number(data.teamSize) > 20) && (
              <p className="text-xs text-red-400">팀원 수는 2명 이상 20명 이하여야 합니다.</p>
            )}
        </div>
      </div>

      <div className="flex gap-2">
        <Button variant="outline" size="lg" className="flex-1" onClick={onBack}>
          이전
        </Button>
        <Button size="lg" className="flex-1" disabled={!isValid} onClick={onNext}>
          다음
        </Button>
      </div>
    </div>
  );
}

// ─── Step 3: 설명 입력 ─────────────────────────────────────────────────────

function Step3({
  data,
  onChange,
  onSubmit,
  onBack,
  isSubmitting,
}: {
  data: FormData;
  onChange: (patch: Partial<FormData>) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-xl font-semibold text-gray-900">프로젝트를 설명해주세요</h2>
        <p className="mt-1 text-sm text-gray-400">
          AI가 내용을 분석해 태스크를 자동으로 생성합니다.
        </p>
      </div>

      <textarea
        value={data.description}
        onChange={(e) => onChange({ description: e.target.value })}
        rows={10}
        placeholder="팀 공지사항이나 프로젝트 계획을 붙여넣어 주세요. AI가 이를 바탕으로 태스크를 생성합니다."
        className="w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none focus:border-gray-400 focus:ring-2 focus:ring-gray-200 transition leading-relaxed"
      />

      <div className="flex gap-2">
        <Button variant="outline" size="lg" className="flex-1" onClick={onBack} disabled={isSubmitting}>
          이전
        </Button>
        <Button
          size="lg"
          className="flex-1"
          disabled={!data.description.trim() || isSubmitting}
          onClick={onSubmit}
        >
          {isSubmitting ? 'AI 분석 중…' : '✨ AI 로드맵 생성'}
        </Button>
      </div>
    </div>
  );
}

// ─── 메인 위저드 페이지 ────────────────────────────────────────────────────

export default function NewProjectPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const step = Math.max(1, Math.min(3, Number(searchParams.get('step') ?? '1')));

  const [formData, setFormData] = useState<FormData>({
    type: null,
    customType: '',
    name: '',
    deadline: '',
    teamSize: '',
    description: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  function patch(partial: Partial<FormData>) {
    setFormData((prev) => ({ ...prev, ...partial }));
  }

  function goToStep(n: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set('step', String(n));
    router.push(`?${params.toString()}`);
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setIsLoading(true);
    try {
      const supabase = createClient();

      // ── 1. 로그인 유저 확인 ──────────────────────────────────────────────
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        alert('로그인이 필요합니다.');
        return;
      }

      // ── 2. Supabase projects 테이블에 INSERT ─────────────────────────────
      const { data: project, error: insertError } = await supabase
        .from('projects')
        .insert({
          name: formData.name,
          type: formData.type,
          custom_type: formData.customType || null,
          description: formData.description,
          deadline: formData.deadline,
          team_size: Number(formData.teamSize),
          owner_id: user.id,
          status: 'setup',
        })
        .select('id')
        .single();

      if (insertError || !project) {
        alert('프로젝트 생성에 실패했어요.');
        return;
      }

      const projectId = project.id as string;

      // ── 2-1. 개설자를 project_members에 자동 추가 ────────────────────────
      await supabase.from('project_members').insert({
        project_id: projectId,
        user_id: user.id,
        role_preference: null,
      });

      // ── 3. AI 로드맵 생성 API 호출 ───────────────────────────────────────
      const res = await fetch('/api/ai/generate-roadmap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          type: formData.type,
          customType: formData.customType,
          description: formData.description,
          deadline: formData.deadline,
          teamSize: Number(formData.teamSize),
        }),
      });

      if (!res.ok) {
        alert('AI 로드맵 생성에 실패했어요.');
        return;
      }

      const { tasks } = await res.json();

      // ── 4. tasks를 sessionStorage에 저장 후 roadmap 페이지로 이동 ────────
      sessionStorage.setItem(`roadmap-${projectId}`, JSON.stringify(tasks));
      router.push(`/project/${projectId}/roadmap`);
    } finally {
      setIsSubmitting(false);
      setIsLoading(false);
    }
  }

  return (
    <>
      {/* 로딩 오버레이 */}
      {isLoading && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-4">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-200 border-t-gray-900" />
            <p className="text-sm font-medium text-gray-700">
              AI가 로드맵을 분석하고 있어요...
            </p>
          </div>
        </div>
      )}

      <div className="min-h-screen bg-white flex items-start justify-center px-4 py-16">
        <div className="w-full max-w-md">
          {/* 헤더 */}
          <div className="flex items-center gap-3 mb-8">
            <button
              type="button"
              onClick={() => (step > 1 ? goToStep(step - 1) : router.push('/dashboard'))}
              className="text-gray-400 hover:text-gray-700 transition text-sm"
              aria-label="뒤로가기"
            >
              ← 뒤로
            </button>
            <span className="text-sm font-semibold text-gray-900">새 프로젝트</span>
          </div>

          {/* 진행률 */}
          <StepIndicator current={step} total={3} />

          {/* 단계별 컨텐츠 */}
          {step === 1 && (
            <Step1 data={formData} onChange={patch} onNext={() => goToStep(2)} />
          )}
          {step === 2 && (
            <Step2
              data={formData}
              onChange={patch}
              onNext={() => goToStep(3)}
              onBack={() => goToStep(1)}
            />
          )}
          {step === 3 && (
            <Step3
              data={formData}
              onChange={patch}
              onSubmit={handleSubmit}
              onBack={() => goToStep(2)}
              isSubmitting={isSubmitting}
            />
          )}
        </div>
      </div>
    </>
  );
}
