// UNREVIEWED RED CANDIDATE. Copy to desktop/tests/main/meeting-mutation-model-lifecycle.test.ts.
// @vitest-environment node
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { createMeetingModelService, type MeetingModelDefinition } from '../../electron/meeting-model-service.js';
import { createMeetingAudioPermissionService } from '../../electron/meeting-audio-permission.js';
import { DesktopShutdownGate, ShutdownAwareIpcMain, type IpcHandlerListener } from '../../electron/shutdown-aware-ipc-main.js';
const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function heldFixture(directory = false) {
  const cacheDir = mkdtempSync(join(tmpdir(), 'meeting-model-lease-owned-')); roots.push(cacheDir);
  let release!: () => void; const held = new Promise<void>(r => { release = r; }); let calls = 0;
  const bytes = Buffer.from('owned-model-bytes');
  const model: MeetingModelDefinition = { id: 'owned', fileName: directory ? 'owned-dir' : 'owned.bin', url: 'https://owned.invalid/model', expectedSizeBytes: bytes.length, expectedSha256: createHash('sha256').update(bytes).digest('hex'), ...(directory ? { packageType: 'directory' as const, archiveFileName: 'owned.tar.bz2', requiredFiles: ['model.bin'] } : {}) };
  const options = { cacheDir, models: [model], downloadFile: async (_url: string, destination: string) => { calls++; await held; writeFileSync(destination, bytes); } };
  return { cacheDir, model, release, calls: () => calls, first: createMeetingModelService(options), second: createMeetingModelService(options) };
}
it('same cache/model across real service instances rejects a concurrent download', async () => {
  const f = heldFixture(); const first = f.first.downloadModel('owned');
  let secondError: unknown, succeeded = false;
  const second = f.second.downloadModel('owned').then(() => { succeeded = true; }, error => { secondError = error; });
  await Promise.resolve(); const before = f.calls();
  f.release(); await Promise.all([first, second]);
  expect(before).toBe(1); expect(succeeded).toBe(false); expect(secondError).toMatchObject({ message: 'meeting_model_busy' });
});
it('actual uninstall cannot ACK while an admitted download can recreate the model', async () => {
  const f = heldFixture(); const download = f.first.downloadModel('owned'); let failure: unknown;
  try { f.second.uninstallModel('owned'); } catch (error) { failure = error; } finally { f.release(); }
  await download; expect(failure).toMatchObject({ message: 'meeting_model_busy' });
  const result = f.second.uninstallModel('owned'); expect(result.ok).toBe(true); expect(result.model.packageState).toBe('missing'); expect(existsSync(join(f.cacheDir, f.model.fileName))).toBe(false);
});
it('failed real download releases its cache/model lease for a later action', async () => {
  const cacheDir = mkdtempSync(join(tmpdir(), 'meeting-model-failure-owned-')); roots.push(cacheDir);
  const model = { id: 'owned', fileName: 'owned.bin', url: 'https://owned.invalid', expectedSizeBytes: 1, expectedSha256: '0'.repeat(64) };
  const service = createMeetingModelService({ cacheDir, models: [model], downloadFile: async () => { throw Error('owned-transfer-failed'); } });
  await expect(service.downloadModel('owned')).rejects.toThrow('owned-transfer-failed'); expect(service.uninstallModel('owned').ok).toBe(true);
});
it('real directory extraction remains covered by the download lease until settlement', async () => {
  const f = heldFixture(true); f.release();
  let finish!: () => void, started!: () => void;
  const extracting = new Promise<void>(r => { started = r; }), held = new Promise<void>(r => { finish = r; });
  const service = createMeetingModelService({ cacheDir: f.cacheDir, models: [f.model], downloadFile: async (_url, path) => writeFileSync(path, Buffer.from('owned-model-bytes')), extractArchive: async () => { started(); await held; throw Error('owned-extraction-failed'); } });
  const operation = service.downloadModel('owned').catch(error => error); await extracting;
  let error: unknown; try { f.second.uninstallModel('owned'); } catch (value) { error = value; } finally { finish(); }
  expect((await operation).message).toBe('owned-extraction-failed'); expect(error).toMatchObject({ message: 'meeting_model_busy' }); expect(f.second.uninstallModel('owned').ok).toBe(true);
});
it('physical shutdown token remains held for the real download, then releases on completion', async () => {
  const f = heldFixture(), gate = new DesktopShutdownGate(); let listener!: IpcHandlerListener;
  const ipc = new ShutdownAwareIpcMain({ handle: (_channel, value) => { listener = value; } }, gate);
  ipc.handle('owned:test:real-model-download', () => f.first.downloadModel('owned'));
  const operation = listener({} as never); expect(gate.outstanding).toBe(1); gate.close(); const drained = gate.drain(1000);
  f.release(); await operation; expect(await drained).toBe(true); expect(gate.outstanding).toBe(0);
});
it.each(['darwin', 'win32', 'linux'])('real permission service retains %s platform behavior', async platform => {
  let asks = 0; const service = createMeetingAudioPermissionService({ platform, getMediaAccessStatus: () => 'not-determined', askForMediaAccess: async media => { expect(media).toBe('microphone'); asks++; return true; } });
  expect((await service.requestPermission()).status).toBe(platform === 'darwin' ? 'granted' : 'unknown'); expect(asks).toBe(platform === 'darwin' ? 1 : 0);
});
it.each(['granted', 'denied', 'restricted'])('real permission service does not re-prompt Darwin %s', async status => {
  let asks = 0; const service = createMeetingAudioPermissionService({ platform: 'darwin', getMediaAccessStatus: () => status, askForMediaAccess: async () => { asks++; return true; } });
  expect(await service.requestPermission()).toEqual({ status }); expect(asks).toBe(0);
});
