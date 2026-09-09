import { describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { acquireWorkspaceMutationOwner, workspaceOwnerPort } from '../../electron/room-workspace-owner.js';

describe('T33 OS-owned profile-independent mutation gate', () => {
  it('rejects another owner and releases only after physical socket close', async () => {
    const first = await acquireWorkspaceMutationOwner({ port: 0 });
    try {
      await expect(acquireWorkspaceMutationOwner({ port: first.port })).rejects.toThrow('workspace_mutation_owner_busy');
      expect(first.isOwner()).toBe(true);
      await first.close(); expect(first.isOwner()).toBe(false);
      const replacement = await acquireWorkspaceMutationOwner({ port: first.port });
      await replacement.close();
    } finally { await first.close(); }
  });
  it('derives a stable key from OS user, not app profile or workspace', () => {
    expect(workspaceOwnerPort('same-user')).toBe(workspaceOwnerPort('same-user'));
    expect(workspaceOwnerPort('same-user')).toBeGreaterThan(1024);
  });
  it('reclaims the actual OS lock after a different process exits', async () => {
    const entry = pathToFileURL(resolve('electron/room-workspace-owner.ts')).href;
    const child = spawn(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', `import { acquireWorkspaceMutationOwner } from ${JSON.stringify(entry)}; const owner = await acquireWorkspaceMutationOwner({port:0}); process.stdout.write(JSON.stringify({port:owner.port})+'\\n');`], { stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = once(child, 'close');
    try {
      const output = await Promise.race([once(child.stdout, 'data').then(([chunk]) => String(chunk)), exited.then(([code]) => { throw new Error(`owner child exited before ready: ${code}`); })]);
      const port = JSON.parse(output).port;
      await expect(acquireWorkspaceMutationOwner({ port })).rejects.toThrow('workspace_mutation_owner_busy');
      child.kill('SIGKILL');
      await exited;
      const recovered = await acquireWorkspaceMutationOwner({ port });
      expect(recovered.isOwner()).toBe(true);
      await recovered.close();
    } finally { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); await exited; }
  });
});
