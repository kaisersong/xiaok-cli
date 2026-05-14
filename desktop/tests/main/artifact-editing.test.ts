import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  sessionHash,
  backupArtifact,
  revertArtifact,
  cleanupBackups,
  watchArtifactFile,
  unwatchArtifactFile,
  saveSession,
  loadSession,
  deleteSession,
} from '../../electron/artifact-editing.js';

describe('artifact-editing', () => {
  let testDir: string;
  let baseDir: string;
  let artifactPath: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `xiaok-artifact-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    baseDir = join(testDir, '.xiaok');
    mkdirSync(testDir, { recursive: true });
    artifactPath = join(testDir, 'report.html');
    writeFileSync(artifactPath, '<html><body><h1>Original</h1></body></html>');
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  // --- Session Hash ---
  describe('sessionHash', () => {
    it('generates 16-char hex hash from file path', () => {
      const hash = sessionHash('/path/to/file.html');
      expect(hash).toHaveLength(16);
      expect(/^[0-9a-f]{16}$/.test(hash)).toBe(true);
    });

    it('same path produces same hash', () => {
      expect(sessionHash('/a/b.html')).toBe(sessionHash('/a/b.html'));
    });

    it('different paths produce different hashes', () => {
      expect(sessionHash('/a/b.html')).not.toBe(sessionHash('/a/c.html'));
    });
  });

  // --- File Backup ---
  describe('backupArtifact', () => {
    it('creates backup file in correct directory', () => {
      const sid = sessionHash(artifactPath);
      const result = backupArtifact(artifactPath, sid, baseDir);
      expect(result).not.toBeNull();
      expect(existsSync(result!)).toBe(true);
      expect(readFileSync(result!, 'utf8')).toContain('Original');
    });

    it('returns null if source file does not exist', () => {
      const sid = sessionHash('/nonexistent.html');
      expect(backupArtifact('/nonexistent.html', sid, baseDir)).toBeNull();
    });

    it('FIFO eviction: keeps at most 5 backups', async () => {
      const sid = sessionHash(artifactPath);
      for (let i = 0; i < 7; i++) {
        writeFileSync(artifactPath, `<html>version ${i}</html>`);
        backupArtifact(artifactPath, sid, baseDir);
        // Small delay to ensure unique timestamps
        await new Promise((r) => setTimeout(r, 5));
      }
      const dir = join(baseDir, 'artifact-backups', sid);
      const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
      expect(files.length).toBeLessThanOrEqual(5);
    });
  });

  // --- Revert ---
  describe('revertArtifact', () => {
    it('restores file to latest backup content', () => {
      const sid = sessionHash(artifactPath);
      backupArtifact(artifactPath, sid, baseDir);
      writeFileSync(artifactPath, '<html>Modified</html>');
      const ok = revertArtifact(artifactPath, sid, baseDir);
      expect(ok).toBe(true);
      expect(readFileSync(artifactPath, 'utf8')).toContain('Original');
    });

    it('returns false if no backups exist', () => {
      const sid = sessionHash(artifactPath);
      expect(revertArtifact(artifactPath, sid, baseDir)).toBe(false);
    });

    it('removes used backup after revert', () => {
      const sid = sessionHash(artifactPath);
      backupArtifact(artifactPath, sid, baseDir);
      revertArtifact(artifactPath, sid, baseDir);
      const dir = join(baseDir, 'artifact-backups', sid);
      const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
      expect(files.length).toBe(0);
    });
  });

  // --- Cleanup ---
  describe('cleanupBackups', () => {
    it('removes backup directory for session', () => {
      const sid = sessionHash(artifactPath);
      backupArtifact(artifactPath, sid, baseDir);
      cleanupBackups(sid, baseDir);
      const dir = join(baseDir, 'artifact-backups', sid);
      expect(existsSync(dir)).toBe(false);
    });
  });

  // --- File Watcher ---
  describe('watchArtifactFile', () => {
    it('calls onChange when file changes', { retry: 2 }, async () => {
      const onChange = vi.fn();
      const cleanup = watchArtifactFile(artifactPath, onChange);
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(artifactPath, '<html>Changed</html>');
      await new Promise((r) => setTimeout(r, 1000));
      expect(onChange).toHaveBeenCalled();
      cleanup();
    });

    it('debounces multiple rapid changes', { retry: 2 }, async () => {
      const onChange = vi.fn();
      const cleanup = watchArtifactFile(artifactPath, onChange);
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(artifactPath, '<html>A</html>');
      writeFileSync(artifactPath, '<html>B</html>');
      writeFileSync(artifactPath, '<html>C</html>');
      await new Promise((r) => setTimeout(r, 1000));
      expect(onChange.mock.calls.length).toBeLessThanOrEqual(2);
      cleanup();
    });

    it('unwatchArtifactFile stops notifications', async () => {
      const onChange = vi.fn();
      watchArtifactFile(artifactPath, onChange);
      unwatchArtifactFile(artifactPath);
      await new Promise((r) => setTimeout(r, 100));
      writeFileSync(artifactPath, '<html>Changed</html>');
      await new Promise((r) => setTimeout(r, 1000));
      expect(onChange).not.toHaveBeenCalled();
    });
  });

  // --- Session Persistence ---
  describe('session persistence', () => {
    it('saveSession + loadSession roundtrip', () => {
      const session = {
        filePath: artifactPath,
        sessionId: 'abc123',
        state: 'preview' as const,
        createdAt: Date.now(),
      };
      saveSession(session, baseDir);
      const loaded = loadSession('abc123', baseDir);
      expect(loaded).toEqual(session);
    });

    it('loadSession returns null for non-existent', () => {
      expect(loadSession('nonexistent', baseDir)).toBeNull();
    });

    it('deleteSession removes file', () => {
      const session = {
        filePath: artifactPath,
        sessionId: 'del123',
        state: 'annotating' as const,
        createdAt: Date.now(),
      };
      saveSession(session, baseDir);
      deleteSession('del123', baseDir);
      expect(loadSession('del123', baseDir)).toBeNull();
    });
  });
});
