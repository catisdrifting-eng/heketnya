import type { ProjectType } from '@/types';

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
