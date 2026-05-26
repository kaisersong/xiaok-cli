import { describe, it, expect } from 'vitest';
import {
  isScreenAutomationFallbackInvocation,
  isSensitivePath,
  isSensitiveToolInvocation,
  SENSITIVE_BASENAMES,
} from '../../../src/ai/permissions/sensitive-paths.js';

describe('sensitive-paths', () => {
  describe('isSensitivePath', () => {
    it('flags exact basename matches', () => {
      expect(isSensitivePath('/repo/.env')).toBe(true);
      expect(isSensitivePath('/repo/sub/.env')).toBe(true);
      expect(isSensitivePath('/repo/id_rsa')).toBe(true);
      expect(isSensitivePath('/home/user/.netrc')).toBe(true);
      expect(isSensitivePath('/repo/credentials.json')).toBe(true);
    });

    it('does not flag look-alike file names', () => {
      expect(isSensitivePath('/repo/.env.example')).toBe(false);
      expect(isSensitivePath('/repo/notes/id_rsa.md')).toBe(false);
      expect(isSensitivePath('/repo/credentials.json.bak')).toBe(false);
    });

    it('flags glob extensions', () => {
      expect(isSensitivePath('/etc/server.pem')).toBe(true);
      expect(isSensitivePath('/etc/server.key')).toBe(true);
      expect(isSensitivePath('/etc/server.p12')).toBe(true);
      expect(isSensitivePath('/etc/cert.pem.txt')).toBe(false);
    });

    it('flags sensitive path segments', () => {
      expect(isSensitivePath('/home/user/.ssh/known_hosts')).toBe(true);
      expect(isSensitivePath('/home/user/.aws/config')).toBe(true);
      expect(isSensitivePath('/home/user/.gnupg/pubring.kbx')).toBe(true);
    });

    it('handles windows backslash paths', () => {
      expect(isSensitivePath('C:\\repo\\.env')).toBe(true);
      expect(isSensitivePath('C:\\Users\\me\\.ssh\\id_rsa')).toBe(true);
      expect(isSensitivePath('C:\\repo\\readme.md')).toBe(false);
    });

    it('returns false for empty input', () => {
      expect(isSensitivePath('')).toBe(false);
    });

    it('exposes static set without runtime mutation safety surprises', () => {
      expect(SENSITIVE_BASENAMES.has('.env')).toBe(true);
      expect(SENSITIVE_BASENAMES.has('id_rsa')).toBe(true);
    });
  });

  describe('isSensitiveToolInvocation', () => {
    it('flags read/write/edit on sensitive paths', () => {
      expect(isSensitiveToolInvocation('read', { file_path: '/repo/.env' })).toBe(true);
      expect(isSensitiveToolInvocation('write', { file_path: '/repo/id_rsa' })).toBe(true);
      expect(isSensitiveToolInvocation('edit', { file_path: '/etc/server.pem' })).toBe(true);
    });

    it('ignores non file tools', () => {
      expect(isSensitiveToolInvocation('bash', { command: 'cat .env' })).toBe(false);
      expect(isSensitiveToolInvocation('grep', { path: '/repo/.env' })).toBe(false);
    });

    it('reads from `path` field when file_path missing', () => {
      // read tool currently uses file_path but defensive
      expect(isSensitiveToolInvocation('read', { path: '/repo/.env' })).toBe(true);
    });

    it('returns false when target string missing', () => {
      expect(isSensitiveToolInvocation('read', {})).toBe(false);
    });
  });

  describe('isScreenAutomationFallbackInvocation', () => {
    it('flags shell commands that bypass Computer Use for screenshots or desktop control', () => {
      expect(isScreenAutomationFallbackInvocation('bash', { command: 'screencapture -x /tmp/s.png' })).toBe(true);
      expect(isScreenAutomationFallbackInvocation('bash', { command: 'cliclick c:10,10' })).toBe(true);
      expect(isScreenAutomationFallbackInvocation('bash', { command: 'cua-driver mcp' })).toBe(true);
      expect(isScreenAutomationFallbackInvocation('bash', { command: 'open -n -g -a CuaDriver --args serve' })).toBe(true);
      expect(isScreenAutomationFallbackInvocation('bash', { command: 'open -n -g /Applications/CuaDriver.app --args serve' })).toBe(true);
      expect(isScreenAutomationFallbackInvocation('bash', {
        command: 'rm -f /Users/song/Library/Caches/cua-driver/cua-driver.sock',
      })).toBe(true);
      expect(isScreenAutomationFallbackInvocation('bash', {
        command: 'osascript -e \'tell application "System Events" to keystroke "q" using command down\'',
      })).toBe(true);
    });

    it('does not flag unrelated shell commands or non-bash tools', () => {
      expect(isScreenAutomationFallbackInvocation('bash', { command: 'echo screenshot notes' })).toBe(false);
      expect(isScreenAutomationFallbackInvocation('read', { file_path: '/tmp/screencapture.txt' })).toBe(false);
    });
  });
});
