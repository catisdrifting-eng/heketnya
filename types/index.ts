// ─── Enums / Union Types ───────────────────────────────────────────────────

export type ProjectStatus = 'setup' | 'selecting' | 'active' | 'completed';

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export type RolePreference =
  | 'research'
  | 'writing'
  | 'presentation'
  | 'coding'
  | 'any';

export type ProjectType = 'school' | 'startup' | 'thesis' | 'other';

// ─── Interfaces ────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  name: string;
  avatar_url?: string;
  role_preference?: RolePreference;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  title: string;
  description?: string;
  type: ProjectType;
  status: ProjectStatus;
  owner_id: string;
  deadline?: string;
  created_at: string;
  updated_at: string;
}

export interface Task {
  id: string;
  project_id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignee_id?: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  project_id: string;
  user_id: string;
  role?: RolePreference;
  joined_at: string;
}
