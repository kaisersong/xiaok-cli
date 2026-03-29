import { loadConfig } from '../utils/config.js';

export interface DevAppIdentity {
  appKey: string;
  appSecret: string;
}

export async function getDevAppIdentity(): Promise<DevAppIdentity | null> {
  const config = await loadConfig();
  if (!config.devApp) return null;
  return config.devApp;
}

export function formatIdentityContext(identity: DevAppIdentity | null): string {
  if (!identity) return '';
  return `开发者应用：appKey=${identity.appKey}`;
}
