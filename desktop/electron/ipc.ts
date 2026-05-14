import { clipboard, dialog, type BrowserWindow, type IpcMain } from 'electron';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { createDesktopServices } from './desktop-services.js';

type DesktopServices = ReturnType<typeof createDesktopServices>;

function log(level: string, msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const payload = args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
  console.log(`[${ts}] [${level}] [ipc] ${msg}${payload}`);
}

export async function registerDesktopIpc(ipcMain: IpcMain, window: BrowserWindow, services: DesktopServices): Promise<void> {
  ipcMain.handle('desktop:getModelConfig', async () => {
    log('info', 'getModelConfig');
    const r = await services.getModelConfig();
    log('info', 'getModelConfig ok', { providers: r?.providers?.length ?? 0 });
    return r;
  });
  ipcMain.handle('desktop:saveModelConfig', async (_event, input) => {
    log('info', 'saveModelConfig', { providerId: input?.providerId });
    const r = await services.saveModelConfig(input);
    log('info', 'saveModelConfig ok');
    return r;
  });
  ipcMain.handle('desktop:testProviderConnection', async (_event, input) => {
    log('info', 'testProviderConnection', { providerId: input?.providerId });
    const r = await services.testProviderConnection(input);
    log('info', 'testProviderConnection ok', { success: r?.success, latencyMs: r?.latencyMs });
    return r;
  });
  ipcMain.handle('desktop:listAvailableModelsForProvider', async (_event, providerId) => {
    log('info', 'listAvailableModelsForProvider', { providerId });
    const r = await services.listAvailableModelsForProvider(providerId);
    log('info', 'listAvailableModelsForProvider ok', { count: r?.length });
    return r;
  });
  ipcMain.handle('desktop:deleteProvider', async (_event, providerId) => {
    log('info', 'deleteProvider', { providerId });
    await services.deleteProvider(providerId);
    log('info', 'deleteProvider ok');
  });
  ipcMain.handle('desktop:deleteModel', async (_event, modelId) => {
    log('info', 'deleteModel', { modelId });
    await services.deleteModel(modelId);
    log('info', 'deleteModel ok');
  });
  ipcMain.handle('desktop:readClipboardFilePaths', async () => {
    // macOS Finder copy puts file URLs in 'public.file-url' pasteboard type
    // Electron clipboard.read('NSFilenamesPboardType') returns newline-separated paths
    try {
      const raw = clipboard.read('NSFilenamesPboardType');
      if (raw) {
        // NSFilenamesPboardType returns a plist XML string; extract paths from it
        const paths = raw.match(/<string>(.*?)<\/string>/g)?.map(m => m.replace(/<\/?string>/g, '')) ?? [];
        return paths.filter(p => p.startsWith('/'));
      }
    } catch { /* not available on this platform */ }
    return [];
  });
  ipcMain.handle('desktop:selectMaterials', async () => {
    log('info', 'selectMaterials');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    if (result.canceled) {
      log('info', 'selectMaterials cancelled');
      return { filePaths: [] };
    }
    const expanded = await expandSelectedMaterialPaths(result.filePaths);
    log('info', 'selectMaterials ok', { fileCount: expanded.length });
    return { filePaths: expanded };
  });
  ipcMain.handle('desktop:importMaterial', async (_event, input) => {
    log('info', 'importMaterial', { filePath: input?.filePath });
    const r = await services.importMaterial(input);
    log('info', 'importMaterial ok');
    return r;
  });
  ipcMain.handle('desktop:createTask', async (_event, input) => {
    log('info', 'createTask', { prompt: input?.prompt?.slice(0, 50) });
    const r = await services.createTask(input);
    log('info', 'createTask ok', { taskId: r?.taskId });
    return r;
  });
  ipcMain.handle('desktop:answerQuestion', async (_event, input) => {
    log('info', 'answerQuestion', { taskId: input?.taskId });
    const r = await services.answerQuestion(input);
    log('info', 'answerQuestion ok');
    return r;
  });
  ipcMain.handle('desktop:cancelTask', async (_event, input) => {
    log('info', 'cancelTask', { taskId: input?.taskId });
    await services.cancelTask(input.taskId);
    log('info', 'cancelTask ok');
  });
  ipcMain.handle('desktop:getActiveTask', async () => {
    const r = await services.getActiveTask();
    log('debug', 'getActiveTask', { taskId: r?.taskId ?? null });
    return r;
  });
  ipcMain.handle('desktop:recoverTask', async (_event, input) => {
    log('info', 'recoverTask', { taskId: input?.taskId });
    const r = await services.recoverTask(input.taskId);
    log('info', 'recoverTask ok', { status: r?.snapshot?.status });
    return r;
  });
  ipcMain.handle('desktop:openArtifact', async (_event, input) => {
    log('info', 'openArtifact', { artifactId: input?.artifactId });
    return services.openArtifact(input.artifactId);
  });
  ipcMain.handle('desktop:readFileContent', async (_event, input) => {
    const filePath = input?.filePath as string;
    log('info', 'readFileContent', { filePath });
    try {
      const content = await readFile(filePath, 'utf-8');
      return { content };
    } catch (e) {
      return { content: '', error: String(e) };
    }
  });
  const activeTaskSubs = new Map<string, AbortController>();
  ipcMain.handle('desktop:subscribeTask', async (_event, input) => {
    const taskId = input.taskId as string;
    log('info', 'subscribeTask', { taskId });

    // Cancel any existing subscription for this taskId to prevent duplicate streams
    const prev = activeTaskSubs.get(taskId);
    if (prev) {
      prev.abort();
      activeTaskSubs.delete(taskId);
    }

    const controller = new AbortController();
    activeTaskSubs.set(taskId, controller);

    void (async () => {
      try {
        for await (const event of services.subscribeTask(taskId)) {
          if (controller.signal.aborted || window.isDestroyed()) {
            break;
          }
          window.webContents.send(`desktop:taskEvent:${taskId}`, event);
        }
        log('info', 'subscribeTask stream ended', { taskId });
      } catch (e) {
        if (!controller.signal.aborted) {
          log('error', 'subscribeTask error', { taskId, message: String(e) });
        }
      } finally {
        if (activeTaskSubs.get(taskId) === controller) {
          activeTaskSubs.delete(taskId);
        }
      }
    })();
  });
  ipcMain.handle('desktop:listSkills', async () => {
    const r = await services.listSkills();
    log('info', 'listSkills', { count: r.length });
    return r;
  });
  ipcMain.handle('desktop:installSkill', async (_event, skillName) => {
    log('info', 'installSkill', { skillName });
    const r = await services.installSkill(skillName);
    log('info', 'installSkill result', { success: r.success });
    return r;
  });
  ipcMain.handle('desktop:uninstallSkill', async (_event, skillName) => {
    log('info', 'uninstallSkill', { skillName });
    const r = await services.uninstallSkill(skillName);
    log('info', 'uninstallSkill result', { success: r.success });
    return r;
  });
  // Channel IPC
  ipcMain.handle('desktop:listChannels', async () => services.listChannels());
  ipcMain.handle('desktop:testChannel', async (_event, channelId) => {
    log('info', 'testChannel', { channelId });
    const r = await services.testChannel(channelId);
    log('info', 'testChannel result', { success: r.success });
    return r;
  });
  ipcMain.handle('desktop:createChannel', async (_event, input) => services.createChannel(input));
  ipcMain.handle('desktop:updateChannel', async (_event, id, input) => services.updateChannel(id, input));
  ipcMain.handle('desktop:deleteChannel', async (_event, id) => services.deleteChannel(id));
  // MCP IPC
  ipcMain.handle('desktop:listMCPInstalls', async () => services.listMCPInstalls());
  ipcMain.handle('desktop:createMCPInstall', async (_event, input) => services.createMCPInstall(input));
  ipcMain.handle('desktop:updateMCPInstall', async (_event, id, input) => services.updateMCPInstall(id, input));
  ipcMain.handle('desktop:deleteMCPInstall', async (_event, id) => services.deleteMCPInstall(id));
  // Plugin MCP servers
  ipcMain.handle('desktop:listPluginMcpServers', () => services.listPluginMcpServers());
  ipcMain.handle('desktop:setPluginMcpServerEnabled', (_event, input) => services.setPluginMcpServerEnabled(input));
  ipcMain.handle('desktop:installPlugin', (_event, name) => services.installPlugin(name));
  ipcMain.handle('desktop:listAvailablePlugins', () => services.listAvailablePlugins());
  ipcMain.handle('desktop:createTaskWithFiles', async (_event, input) => {
    log('info', 'createTaskWithFiles', { prompt: input?.prompt?.slice(0, 50), files: input?.filePaths?.length });
    const r = await services.createTaskWithFiles(input);
    log('info', 'createTaskWithFiles ok', { taskId: r?.taskId });
    return r;
  });
  ipcMain.handle('desktop:getSkillStats', async () => {
    try {
      return await services.getSkillStats();
    } catch { return []; }
  });

  // ---- Memory ----
  const { UserMemoryStore } = await import('./user-memory.js');
  const { parseMemories } = await import('./memory-import-parser.js');
  const memoryDir = join(services.getDataRoot(), 'memories');
  const memoryStore = new UserMemoryStore(memoryDir);

  ipcMain.handle('desktop:listMemories', async () => {
    try { return memoryStore.list(); }
    catch (e) { log('error', 'listMemories failed', e); return []; }
  });
  ipcMain.handle('desktop:createMemory', async (_event, input: { content: string; tags: string[]; source?: string }) => {
    try { return memoryStore.create(input); }
    catch (e) { log('error', 'createMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:updateMemory', async (_event, input: { id: string; content?: string; tags?: string[] }) => {
    try { return memoryStore.update(input.id, input); }
    catch (e) { log('error', 'updateMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:deleteMemory', async (_event, id: string) => {
    try { return memoryStore.delete(id); }
    catch (e) { log('error', 'deleteMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:importMemories', async (_event, raw: string) => {
    try {
      const { items, errors } = parseMemories(raw);
      if (items.length === 0 && errors.length === 0) return { imported: 0, deduped: 0, parseErrors: ['未解析到任何记忆'] };
      const result = memoryStore.importMemories(items);
      return { ...result, parseErrors: errors };
    } catch (e) {
      return { imported: 0, deduped: 0, parseErrors: [`导入失败: ${e}`] };
    }
  });

  // ---- Artifact Editing ----
  const { sessionHash, backupArtifact, revertArtifact, cleanupBackups, watchArtifactFile, unwatchArtifactFile } = await import('./artifact-editing.js');

  ipcMain.handle('desktop:artifactBackup', async (_event, filePath: string) => {
    const sid = sessionHash(filePath);
    return backupArtifact(filePath, sid);
  });

  ipcMain.handle('desktop:artifactRevert', async (_event, filePath: string) => {
    const sid = sessionHash(filePath);
    const ok = revertArtifact(filePath, sid);
    if (ok) window.webContents.send('desktop:artifactFileChanged', filePath);
    return ok;
  });

  ipcMain.handle('desktop:artifactCleanup', async (_event, filePath: string) => {
    const sid = sessionHash(filePath);
    cleanupBackups(sid);
  });

  ipcMain.handle('desktop:artifactWatch', async (_event, filePath: string) => {
    watchArtifactFile(filePath, () => {
      window.webContents.send('desktop:artifactFileChanged', filePath);
    });
  });

  ipcMain.handle('desktop:artifactUnwatch', async (_event, filePath: string) => {
    unwatchArtifactFile(filePath);
  });
}

async function expandSelectedMaterialPaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const path of paths) {
    const entry = await stat(path);
    if (entry.isFile()) {
      files.push(path);
      continue;
    }
    if (entry.isDirectory()) {
      files.push(...await listFilesInDirectory(path));
    }
  }
  return files.sort();
}

async function listFilesInDirectory(directory: string): Promise<string[]> {
  const files: string[] = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesInDirectory(path));
      continue;
    }
    if (entry.isFile()) {
      files.push(path);
    }
  }
  return files;
}
