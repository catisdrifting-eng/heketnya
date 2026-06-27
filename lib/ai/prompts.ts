import type { ProjectType, RolePreference } from '@/types';

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

export function generateRoadmapPrompt({
  type,
  customType,
  description,
  deadline,
  teamSize,
}: RoadmapPromptParams): RoadmapPromptResult {
  const projectTypeLabel =
    type === 'school'
      ? '조별과제'
      : type === 'startup'
        ? '스타트업 프로젝트'
        : type === 'thesis'
          ? '논문/연구'
          : customType || '기타 프로젝트';

  const system =
    'You are a project management expert. Respond ONLY with valid JSON. No markdown, no code blocks, no explanations.';

  const user = `You are helping a team plan their project. Based on the information below, generate a list of actionable tasks.

Project Information:
- Type: ${projectTypeLabel}
- Deadline: ${deadline}
- Team size: ${teamSize} people
- Description / Notes:
${description}

Generate a realistic task list that covers the full project lifecycle. Each task should be specific, actionable, and assigned a suggested role.

Respond with this exact JSON structure:
{
  "tasks": [
    {
      "title": "string",
      "description": "string or null",
      "dueDate": "YYYY-MM-DD",
      "suggestedRole": "research|writing|presentation|coding|any",
      "sortOrder": number
    }
  ]
}

Rules:
- dueDate must be on or before ${deadline}
- suggestedRole must be one of: research, writing, presentation, coding, any
- sortOrder starts at 1 and increments by 1
- Generate between 5 and 15 tasks depending on project complexity
- Respond with JSON only, no other text`;

  return { system, user };
}

// ─── AI 태스크 배정 프롬프트 ───────────────────────────────────────────────

interface UnclaimedTask {
  id: string;
  title: string;
  suggestedRole: RolePreference;
}

interface MemberForAssignment {
  userId: string;
  name: string;
  rolePreference: RolePreference;
  claimedCount: number;
}

interface AssignTasksPromptParams {
  unclaimedTasks: UnclaimedTask[];
  members: MemberForAssignment[];
}

// ─── AI 채팅 수정 프롬프트 ────────────────────────────────────────────────

interface ChatModifyTask {
  title: string;
  description: string | null;
  dueDate: string;
  suggestedRole: RolePreference;
  sortOrder: number;
}

interface ChatModifyPromptParams {
  currentTasks: ChatModifyTask[];
  userMessage: string;
  deadline: string;
  teamSize: number;
}

export function chatModifyPrompt({
  currentTasks,
  userMessage,
  deadline,
  teamSize,
}: ChatModifyPromptParams): RoadmapPromptResult {
  const system =
    'You are a task list editor. Respond ONLY with valid JSON. No markdown, no code blocks, no explanations.';

  const user = `You are helping a team edit their project task list based on a user request.

Current Task List:
${JSON.stringify(currentTasks, null, 2)}

Project Context:
- Deadline: ${deadline}
- Team size: ${teamSize} people

User Request:
"${userMessage}"

Apply the user's request to the task list. You may add, remove, split, merge, or modify tasks as needed.

Rules:
- dueDate must be on or before ${deadline} (format: YYYY-MM-DD)
- suggestedRole must be one of: research, writing, presentation, coding, any
- sortOrder starts at 1 and increments by 1
- summary must be written in Korean (one sentence describing what changed)
- Return the COMPLETE updated task list, not just the changed tasks

Respond with this exact JSON structure:
{
  "tasks": [
    {
      "title": "string",
      "description": "string or null",
      "dueDate": "YYYY-MM-DD",
      "suggestedRole": "research|writing|presentation|coding|any",
      "sortOrder": number
    }
  ],
  "summary": "변경 내용 한 줄 요약"
}

Respond with JSON only, no other text.`;

  return { system, user };
}

export function assignTasksPrompt({
  unclaimedTasks,
  members,
}: AssignTasksPromptParams): RoadmapPromptResult {
  const system =
    'You are a task assignment optimizer. Respond ONLY with valid JSON. No markdown, no code blocks, no explanations.';

  const user = `You need to assign the following unclaimed tasks to team members.

Unclaimed Tasks:
${JSON.stringify(unclaimedTasks, null, 2)}

Team Members:
${JSON.stringify(members, null, 2)}

Assignment Rules:
1. Prefer matching task suggestedRole with member rolePreference.
2. Prioritize members with fewer claimedCount to balance workload.
3. Members with rolePreference "any" should receive remaining tasks after role-matched assignments.
4. Every task must be assigned to exactly one member.
5. reason and summary must be written in Korean.

Respond with this exact JSON structure:
{
  "assignments": [
    { "taskId": "uuid", "assigneeId": "uuid", "reason": "한국어 이유" }
  ],
  "summary": "전체 배정 요약 한국어"
}

Respond with JSON only, no other text.`;

  return { system, user };
}
