// Thread types (local storage)
export type ThreadMode = 'work';
export type ThreadGtdBucket = 'inbox' | 'todo' | 'waiting' | 'someday' | 'archived';

export interface ThreadRecord {
  id: string;
  title: string | null;
  status: 'idle' | 'running' | 'completed' | 'failed';
  mode: ThreadMode;
  createdAt: number;
  updatedAt: number;
  starred: boolean;
  gtdBucket: ThreadGtdBucket | null;
  pinnedAt: number | null;
}

// Persona types (mock)
export interface Persona {
  persona_key: string;
  display_name: string;
  description?: string;
}

// Skill types (mock)
export interface SkillPackage {
  skill_key: string;
  display_name: string;
  is_active: boolean;
}

// User types (local mode)
export interface MeResponse {
  id: string;
  username: string;
  email?: string;
  email_verified: boolean;
  work_enabled: boolean;
}

// Config types
export interface CaptchaConfig { enabled: boolean; }
export interface MemoryConfig { enabled: boolean; }
export interface ConnectorsConfig {
  fetch: { provider: 'none' };
  search: { provider: 'none' };
}
export interface CreditsBalance { balance: number; }