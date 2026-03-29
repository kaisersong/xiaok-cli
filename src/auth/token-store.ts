import { readFileSync, writeFileSync, chmodSync, existsSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { getConfigDir } from '../utils/config.js';
import type { Credentials } from '../types.js';

function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

export async function loadCredentials(): Promise<Credentials | null> {
  const path = getCredentialsPath();
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    return JSON.parse(raw) as Credentials;
  } catch {
    return null;
  }
}

export async function saveCredentials(creds: Credentials): Promise<void> {
  const dir = getConfigDir();
  mkdirSync(dir, { recursive: true });
  const path = getCredentialsPath();
  writeFileSync(path, JSON.stringify(creds, null, 2), 'utf-8');
  if (process.platform !== 'win32') {
    chmodSync(path, 0o600);
  }
}

export async function clearCredentials(): Promise<void> {
  const path = getCredentialsPath();
  if (existsSync(path)) rmSync(path);
}
