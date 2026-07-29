import { chmod, lchmod, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

async function loadTreeDigestModule(): Promise<any> {
  return import(pathToFileURL(join(
    process.cwd(),
    'scripts/evals/kimi-k3-d9/tree-digest.mjs',
  )).href);
}

describe.skipIf(process.platform === 'win32')('Kimi K3 D9 canonical full-tree digest', () => {
  it('covers the root, empty directories, modes, symlink targets, and arbitrary bytes', async () => {
    const { digestTree } = await loadTreeDigestModule();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-tree-'));
    try {
      await chmod(root, 0o750);
      await mkdir(join(root, 'empty'), { mode: 0o711 });
      await chmod(join(root, 'empty'), 0o711);
      await writeFile(join(root, 'payload.bin'), Buffer.from([0, 255, 1]), { mode: 0o640 });
      await chmod(join(root, 'payload.bin'), 0o640);
      await symlink('payload.bin', join(root, 'payload-link'));
      if (process.platform === 'darwin') {
        await lchmod(join(root, 'payload-link'), 0o777);
      }

      const result = await digestTree(root);
      expect(result.entries).toEqual([
        { relativePath: '.', fileType: 'directory', mode: 0o750 },
        { relativePath: 'empty', fileType: 'directory', mode: 0o711 },
        {
          relativePath: 'payload-link',
          fileType: 'symlink',
          mode: 0o777,
          target: 'payload.bin',
        },
        {
          relativePath: 'payload.bin',
          fileType: 'file',
          mode: 0o640,
          contentSha256: '47ffa3ea45a70b8a41c2c0825df323c00a8b7a01c1ea06083cc41dddcc001123',
        },
      ]);
      expect(result.digest).toBe(
        '120978ef649d3ac07f5d5251de80396664ff93517d43d3b20c178e8107fb1ee6',
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('changes when a resource byte, mode, empty directory, or symlink target changes', async () => {
    const { digestTree } = await loadTreeDigestModule();
    const root = await mkdtemp(join(tmpdir(), 'kimi-d9-tree-drift-'));
    try {
      await mkdir(join(root, 'empty'));
      await writeFile(join(root, 'resource.txt'), 'alpha');
      await symlink('resource.txt', join(root, 'resource-link'));
      const initial = (await digestTree(root)).digest;

      await writeFile(join(root, 'resource.txt'), 'beta');
      const byteDrift = (await digestTree(root)).digest;
      expect(byteDrift).not.toBe(initial);

      await chmod(join(root, 'resource.txt'), 0o600);
      const modeDrift = (await digestTree(root)).digest;
      expect(modeDrift).not.toBe(byteDrift);

      await rm(join(root, 'empty'), { recursive: true });
      const directoryDrift = (await digestTree(root)).digest;
      expect(directoryDrift).not.toBe(modeDrift);

      await rm(join(root, 'resource-link'));
      await symlink('other.txt', join(root, 'resource-link'));
      expect((await digestTree(root)).digest).not.toBe(directoryDrift);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
