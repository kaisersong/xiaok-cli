export type ConnectionMode = 'local' | 'saas' | 'self-hosted';
export type DesktopPlatform = 'win32' | 'darwin' | 'linux';
export function isDesktop(): boolean { return true; }
export function isLocalMode(): boolean { return true; }
export function getDesktopApi(): Record<string, unknown> | null { return null; }
export function getDesktopAccessToken(): string | null { return 'local-token'; }
export interface AppUpdaterState { phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready'; progress?: number; }
export type DesktopSettingsKey = 'general' | 'appearance' | 'providers' | 'agents' | 'channels' | 'tools' | 'skills' | 'memory' | 'security' | 'advanced' | 'about';
