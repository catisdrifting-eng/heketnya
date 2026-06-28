import type { ProjectType } from '@/types';

interface Role {
  id: string;
  label: string;
}

interface RoadmapPromptParams {
  type: ProjectType;
  customType?: string;
  description: string;
  deadline: string;
  teamSize: number;
}

interface RoadmapPromptResult {
  system: string;
  user: string;
}

const today = () => new Date().toISOString().split('T')[0];

const projectLabel = (type: ProjectType, customType?: string) =>
  type === 'school' ? '조별과제'
  : type === 'startup' ? '스타트업 프로젝트'
  : type === 'thesis' ? '논문/연구'
  : customType || '기타 프로젝트';

// ─── Call 1: 로드맵 생성 ───────────────────────────────────────
export function generateRoadmapPrompt({
  type, customType, description, deadline, teamSize,
}: RoadmapPromptParams): RoadmapPromptResult {
  const system = `당신은 수백 개의 팀 프로젝트를 성공으로 이끈 베테랑 프로젝트 매니저입니다.
당신의 로드맵은 추상적이지 않고, 팀원이 읽는 즉시 무엇을 해야 할지 아는 구체적인 실행 계획입니다.
반드시 유효한 JSON만 출력합니다. 마크다운, 코드블록, 설명 없이 JSON 객체만 반환합니다.`;

  const user = `오늘 날짜: ${today()}

# 프로젝트 정보
- 유형: ${projectLabel(type, customType)}
- 최종 마감일: ${deadline}
- 팀원 수: ${teamSize}명
- 프로젝트 설명:
${description}

# 작업
이 프로젝트를 성공시키기 위한 역할과 태스크를 설계하세요.

## 1단계: 역할 설계
이 프로젝트 성격에 꼭 맞는 역할을 ${teamSize <= 3 ? '3~4' : '4~6'}개 만드세요.
- 일반적인 역할(리서치/글쓰기)이 아니라 이 프로젝트에 특화된 역할로.
- 예) 논문 → 데이터분석, 논문작성, 실험설계, 발표준비
- 예) 캡스톤 → 프론트엔드, 백엔드, 기획디자인, QA테스트

## 2단계: 태스크 설계
각 태스크는 다음을 반드시 지킵니다.
- title: 무엇을 하는지 한 줄로 명확하게. "자료 조사" 금지. "경쟁 서비스 5개의 핵심 기능 비교 분석" 처럼 구체적으로.
- description: 이 태스크의 산출물(무엇이 나와야 끝인지)과 핵심 포인트를 1~2문장으로.
- suggestedRole: 위에서 만든 역할 id 중 하나. 그 역할과 가장 잘 맞는 태스크에 배정.
- dueDate: 아래 일정 규칙을 따름.

## 일정 규칙 (중요)
- 태스크 간 의존성을 고려하세요. 조사가 끝나야 분석, 분석이 끝나야 작성이 가능합니다.
- 마감일(${deadline})에서 역순으로 배치하세요. 마지막 태스크가 마감일 근처, 첫 태스크가 오늘 근처.
- 한 날짜에 모든 태스크를 몰지 마세요. 프로젝트 기간에 고르게 분산하세요.
- 모든 dueDate는 오늘 이후, ${deadline} 이하여야 합니다.

## 분량 규칙
- 팀원 ${teamSize}명이 감당할 수 있는 양으로. 팀원당 2~4개 태스크가 적절합니다.
- 따라서 전체 ${teamSize * 2}~${teamSize * 4}개 사이로 생성하세요.
- 프로젝트 전체 생애주기(준비 → 실행 → 마무리 → 발표/제출)를 빠짐없이 커버하세요.

# 출력 형식 (이 구조 그대로)
{
  "roles": [
    { "id": "snake_case_영문", "label": "한국어 역할명" }
  ],
  "tasks": [
    {
      "title": "구체적인 태스크명",
      "description": "산출물과 핵심 포인트",
      "dueDate": "YYYY-MM-DD",
      "suggestedRole": "위 roles의 id 중 하나",
      "sortOrder": 1
    }
  ]
}

JSON만 출력하세요.`;

  return { system, user };
}

// ─── Call 2: 채팅 수정 ───────────────────────────────────────
interface ChatModifyTask {
  title: string;
  description: string | null;
  dueDate: string;
  suggestedRole: string;
  sortOrder: number;
}

interface ChatModifyPromptParams {
  currentTasks: ChatModifyTask[];
  roles: Role[];
  userMessage: string;
  deadline: string;
  teamSize: number;
}

export function chatModifyPrompt({
  currentTasks, roles, userMessage, deadline, teamSize,
}: ChatModifyPromptParams): RoadmapPromptResult {
  const system = `당신은 팀 프로젝트 로드맵을 다듬는 편집자입니다.
사용자의 요청을 정확히 그 범위만큼만 반영합니다. 요청하지 않은 태스크는 절대 건드리지 않습니다.
반드시 유효한 JSON만 출력합니다. 마크다운, 코드블록, 설명 없이 JSON 객체만 반환합니다.`;

  const user = `오늘 날짜: ${today()}

# 현재 역할 목록
${JSON.stringify(roles, null, 2)}

# 현재 태스크 목록
${JSON.stringify(currentTasks, null, 2)}

# 프로젝트 정보
- 최종 마감일: ${deadline}
- 팀원 수: ${teamSize}명

# 사용자 요청
"${userMessage}"

# 작업 원칙
- 사용자가 요청한 변경만 적용하세요. 요청과 무관한 태스크는 title·description·dueDate·suggestedRole을 그대로 유지하세요.
- 태스크를 추가할 때 suggestedRole은 위 역할 목록의 id 중에서 고르세요.
- 모든 dueDate는 오늘 이후, ${deadline} 이하. 의존성과 분산을 고려하세요.
- sortOrder는 1부터 순서대로 다시 매기세요.
- summary는 무엇을 바꿨는지 한국어 한 문장으로.

# 출력 형식 (이 구조 그대로)
{
  "tasks": [
    {
      "title": "string",
      "description": "string 또는 null",
      "dueDate": "YYYY-MM-DD",
      "suggestedRole": "역할 id",
      "sortOrder": 1
    }
  ],
  "summary": "변경 내용 한 줄 요약"
}

전체 태스크 목록을 반환하세요. JSON만 출력하세요.`;

  return { system, user };
}

// ─── Call 3: 태스크 배분 ───────────────────────────────────────
interface UnclaimedTask {
  id: string;
  title: string;
  suggestedRole: string;
  dueDate: string | null;
}

interface MemberForAssignment {
  userId: string;
  name: string;
  rolePreference: string;
  currentTasks: string[];
}

interface AssignTasksPromptParams {
  unclaimedTasks: UnclaimedTask[];
  members: MemberForAssignment[];
}

export function assignTasksPrompt({
  unclaimedTasks, members,
}: AssignTasksPromptParams): RoadmapPromptResult {
  const system = `당신은 팀의 업무 부하와 전문성을 고려해 태스크를 공정하게 배분하는 전문가입니다.
반드시 유효한 JSON만 출력합니다. 마크다운, 코드블록, 설명 없이 JSON 객체만 반환합니다.`;

  const user = `# 미배정 태스크
${JSON.stringify(unclaimedTasks, null, 2)}

# 팀원 (각자 이미 맡은 태스크 포함)
${JSON.stringify(members, null, 2)}

# 배분 원칙 (우선순위 순서대로)
1. 역할 매칭: 태스크의 suggestedRole과 팀원의 rolePreference가 일치하면 우선 배정.
2. 부하 균형: 이미 맡은 태스크(currentTasks)가 적은 팀원에게 우선 배정.
3. 쏠림 방지: 같은 성격의 태스크가 한 사람에게 몰리지 않게. currentTasks를 보고 균형을 맞추세요.
4. 마감 우선: dueDate가 임박한 태스크부터 여유 있는 팀원에게 배정.
5. rolePreference가 "any"인 팀원은 역할 매칭이 끝난 뒤 남는 태스크를 받습니다.
6. 모든 태스크는 정확히 한 명에게 배정되어야 합니다.

# 출력 형식 (이 구조 그대로)
{
  "assignments": [
    { "taskId": "uuid", "assigneeId": "uuid", "reason": "이 사람에게 배정한 이유 한국어 한 문장" }
  ],
  "summary": "전체 배정 결과를 2~3문장으로 요약 (누가 어떤 영역을 맡았는지)"
}

reason과 summary는 한국어로. JSON만 출력하세요.`;

  return { system, user };
}
