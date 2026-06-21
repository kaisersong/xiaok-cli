import { clipboard, dialog, shell, type BrowserWindow, type IpcMain } from 'electron';
import { lstat, mkdir, open as openFile, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import type { createDesktopServices } from './desktop-services.js';
import type { DesktopLoopRuntime } from './loop-executor.js';
import type { CreateUserLoopTemplateInput, UserLoopTemplate } from './loop-types.js';
import { isSafeLoopOutputFileName } from './loop-output-paths.js';

type DesktopServices = ReturnType<typeof createDesktopServices>;

interface RegisterDesktopIpcOptions {
  loopRuntime?: Pick<DesktopLoopRuntime, 'loopStore' | 'scanner' | 'runner' | 'listAnomalies'>;
}

const LOOP_OUTPUT_PREVIEW_LIMIT_BYTES = 256 * 1024;
const DATA_URL_MIME_BY_EXTENSION = new Map<string, string>([
  ['.pdf', 'application/pdf'],
]);

function getDataUrlMimeType(filePath: string): string | null {
  return DATA_URL_MIME_BY_EXTENSION.get(extname(filePath).toLowerCase()) ?? null;
}

function decodeBase64DataUrl(content: string): Buffer | null {
  const match = /^data:[^,;]+(?:;[^,]*)*;base64,([\s\S]*)$/i.exec(content);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

function log(level: string, msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const payload = args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
  console.log(`[${ts}] [${level}] [ipc] ${msg}${payload}`);
}

export async function registerDesktopIpc(
  ipcMain: IpcMain,
  window: BrowserWindow,
  services: DesktopServices,
  options: RegisterDesktopIpcOptions = {}
): Promise<void> {
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
  ipcMain.handle('desktop:createManagedXiaokAgent', async (_event, input) => {
    log('info', 'createManagedXiaokAgent', { name: input?.name, roles: input?.roles });
    const r = await services.createManagedXiaokAgent(input);
    log('info', 'createManagedXiaokAgent ok');
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
  ipcMain.handle('desktop:kswarm:startProjectPlanning', async (_event, input) => {
    log('info', 'startProjectPlanning', { projectId: input?.projectId });
    const r = services.startProjectPlanning(input);
    log('info', 'startProjectPlanning ok', { ok: r?.ok });
    return r;
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
  ipcMain.handle('desktop:readClipboardImage', async () => {
    try {
      const img = clipboard.readImage();
      if (img.isEmpty()) return null;
      const png = img.toPNG();
      const tmpDir = join(os.tmpdir(), 'xiaok-clipboard-images');
      await mkdir(tmpDir, { recursive: true });
      const filePath = join(tmpDir, `clipboard-${Date.now()}.png`);
      await writeFile(filePath, png);
      return filePath;
    } catch { return null; }
  });
  ipcMain.handle('desktop:selectDirectory', async () => {
    log('info', 'selectDirectory');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) {
      log('info', 'selectDirectory cancelled');
      return { filePath: '' };
    }
    log('info', 'selectDirectory ok', { filePath: result.filePaths[0] });
    return { filePath: result.filePaths[0] };
  });
  ipcMain.handle('desktop:selectMaterials', async () => {
    log('info', 'selectMaterials');
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'multiSelections'],
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
  ipcMain.handle('desktop:openFileInSystemApp', async (_event, input) => {
    const filePath = input?.filePath as string;
    if (!filePath || !isAbsolute(filePath)) return { ok: false, error: 'invalid_path' };
    const error = await shell.openPath(filePath);
    return error ? { ok: false, error } : { ok: true };
  });
  ipcMain.handle('desktop:readFileContent', async (_event, input) => {
    const filePath = input?.filePath as string;
    log('info', 'readFileContent', { filePath });
    try {
      const dataUrlMimeType = getDataUrlMimeType(filePath);
      if (dataUrlMimeType) {
        const content = await readFile(filePath);
        return { content: `data:${dataUrlMimeType};base64,${content.toString('base64')}` };
      }
      const content = await readFile(filePath, 'utf-8');
      return { content };
    } catch (e) {
      return { content: '', error: String(e) };
    }
  });
  const activeTaskSubs = new Map<string, AbortController>();
  ipcMain.handle('desktop:subscribeTask', async (_event, input) => {
    const taskId = input.taskId as string;
    const sinceIndex = typeof input.sinceIndex === 'number' ? input.sinceIndex : undefined;
    log('info', 'subscribeTask', { taskId, sinceIndex });

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
        const stream = sinceIndex !== undefined
          ? services.subscribeTask(taskId, { sinceIndex })
          : services.subscribeTask(taskId);
        for await (const event of stream) {
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
  ipcMain.handle('desktop:restartPluginMcpServers', () => services.restartPluginMcpServers());
  ipcMain.handle('desktop:restartPluginMcpServer', (_event, input) => services.restartPluginMcpServer(input));
  ipcMain.handle('desktop:getComputerUseCapabilityStatus', () => services.getComputerUseCapabilityStatus());
  ipcMain.handle('desktop:enableComputerUse', () => services.enableComputerUse());
  ipcMain.handle('desktop:reconnectComputerUse', () => services.reconnectComputerUse());
  ipcMain.handle('desktop:disableComputerUse', () => services.disableComputerUse());
  ipcMain.handle('desktop:openPluginDependencyPermissionSettings', async (_event, input) => {
    const permission = String(input?.permission ?? '');
    const pane = permission === 'screen'
      ? 'Privacy_ScreenCapture'
      : 'Privacy_Accessibility';
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
  });
  ipcMain.handle('desktop:installPlugin', (_event, name) => services.installPlugin(name));
  ipcMain.handle('desktop:listAvailablePlugins', () => services.listAvailablePlugins());
  ipcMain.handle('desktop:listPluginDependencyStatuses', () => services.listPluginDependencyStatuses());
  ipcMain.handle('desktop:installPluginDependency', (_event, input) => services.installPluginDependency(input));
  ipcMain.handle('desktop:updatePluginDependency', (_event, input) => services.updatePluginDependency(input));
  ipcMain.handle('desktop:diagnosePluginDependency', (_event, input) => services.diagnosePluginDependency(input));
  ipcMain.handle('desktop:createTaskWithFiles', async (_event, input) => {
    log('info', 'createTaskWithFiles', { prompt: input?.prompt?.slice(0, 50), files: input?.filePaths?.length });
    const expanded = await expandSelectedMaterialPaths(input?.filePaths ?? []);
    const r = await services.createTaskWithFiles({ ...input, filePaths: expanded });
    log('info', 'createTaskWithFiles ok', { taskId: r?.taskId });
    return r;
  });
  ipcMain.handle('desktop:getSkillStats', async () => {
    try {
      return await services.getSkillStats();
    } catch { return []; }
  });
  ipcMain.handle('desktop:trace:export', async (_event, input) => {
    log('info', 'traceExport', { kind: input?.kind, id: input?.id });
    const result = await services.exportTraceBundle(input);
    log('info', 'traceExport result', { ok: result.ok, path: result.path });
    return result;
  });
  ipcMain.handle('desktop:diagnose', async (_event, input) => {
    log('info', 'diagnose', { kind: input?.kind, id: input?.id });
    const result = await services.diagnose(input);
    log('info', 'diagnose result', { health: result?.health, primaryFinding: result?.primaryFinding?.category ?? null });
    return result;
  });

  ipcMain.handle('desktop:loops:listDefinitions', () => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listLoopDefinitions();
  });
  ipcMain.handle('desktop:loops:listUserTemplates', () => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listUserLoopTemplates();
  });
  ipcMain.handle('desktop:loops:createUserTemplate', (_event, input) => {
    log('info', 'loops:createUserTemplate', { title: input?.title, kind: input?.kind, loopId: input?.loopId });
    try {
      const loopRuntime = getLoopRuntime(options);
      const result = loopRuntime.loopStore.createUserLoopTemplate(readCreateUserLoopTemplateInput(input));
      log('info', 'loops:createUserTemplate ok', { loopId: result.template.loopId });
      return result;
    } catch (e) {
      log('error', 'loops:createUserTemplate failed', String(e));
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:updateUserTemplate', (_event, loopId, patch) => {
    log('info', 'loops:updateUserTemplate', { loopId, patchKeys: patch ? Object.keys(patch) : [] });
    try {
      const loopRuntime = getLoopRuntime(options);
      const id = readLoopId(loopId);
      const result = loopRuntime.loopStore.updateUserLoopTemplate(id, patch ?? {});
      log('info', 'loops:updateUserTemplate ok', { loopId: id, found: !!result });
      return result;
    } catch (e) {
      log('error', 'loops:updateUserTemplate failed', { loopId, error: String(e) });
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:deleteUserTemplate', (_event, loopId) => {
    log('info', 'loops:deleteUserTemplate', { loopId });
    try {
      const loopRuntime = getLoopRuntime(options);
      const id = readLoopId(loopId);
      loopRuntime.loopStore.deleteUserLoopTemplate(id);
      log('info', 'loops:deleteUserTemplate ok', { loopId: id });
    } catch (e) {
      log('error', 'loops:deleteUserTemplate failed', { loopId, error: String(e) });
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:openOutputDirectory', async (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    const id = readLoopId(loopId);
    return openLoopOutputDirectory(id, loopRuntime.loopStore.getUserLoopTemplate(id));
  });
  ipcMain.handle('desktop:loops:readOutputPreview', async (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    const id = readLoopId(loopId);
    return readLoopOutputPreview(id, loopRuntime.loopStore.getUserLoopTemplate(id));
  });
  ipcMain.handle('desktop:loops:listRuns', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listLoopRuns(readLoopId(loopId), 20);
  });
  ipcMain.handle('desktop:loops:listAnomalies', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.listAnomalies(readLoopId(loopId));
  });
  ipcMain.handle('desktop:loops:runNow', async (_event, loopId) => {
    log('info', 'loops:runNow', { loopId });
    try {
      const loopRuntime = getLoopRuntime(options);
      const result = await loopRuntime.runner.runLoopNow(readLoopId(loopId));
      log('info', 'loops:runNow result', { loopId, status: result.status });
      return result;
    } catch (e) {
      log('error', 'loops:runNow failed', { loopId, error: String(e) });
      throw e;
    }
  });
  ipcMain.handle('desktop:loops:clearRunHistory', (_event, loopId, statuses) => {
    log('info', 'loops:clearRunHistory', { loopId, statuses });
    try {
      const loopRuntime = getLoopRuntime(options);
      const id = readLoopId(loopId);
      const validStatuses = Array.isArray(statuses) && statuses.every(s => typeof s === 'string') ? statuses : undefined;
      const removed = loopRuntime.loopStore.clearLoopRunHistory(id, validStatuses);
      log('info', 'loops:clearRunHistory ok', { loopId: id, removed });
      return { ok: true, removed };
    } catch (e) {
      log('error', 'loops:clearRunHistory failed', { loopId, error: String(e) });
      throw e;
    }
  });

  // ---- Memory ----
  const { getDesktopMemoryStore } = await import('./desktop-services.js');
  const { parseMemories } = await import('./memory-import-parser.js');
  const memoryStore = getDesktopMemoryStore(services.getDataRoot());

  ipcMain.handle('desktop:listMemories', async () => {
    try {
      if (memoryStore.search) {
        return (await memoryStore.search('', 50)).map(r => ({
          id: r.id, content: r.summary, tags: r.tags, createdAt: r.updatedAt,
        }));
      }
      return (await memoryStore.listRelevant({ cwd: '', query: '' })).map(r => ({
        id: r.id, content: r.summary, tags: r.tags, createdAt: r.updatedAt,
      }));
    } catch (e) { log('error', 'listMemories failed', e); return []; }
  });
  ipcMain.handle('desktop:createMemory', async (_event, input: { content: string; tags: string[]; source?: string }) => {
    try {
      const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await memoryStore.save({
        id, scope: 'global', title: input.content.slice(0, 80),
        summary: input.content, tags: input.tags, updatedAt: Date.now(), type: 'user',
      });
      return { id, content: input.content, tags: input.tags, createdAt: Date.now() };
    } catch (e) { log('error', 'createMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:updateMemory', async (_event, input: { id: string; content?: string; tags?: string[] }) => {
    try {
      // Delete old + re-save with updated content
      await memoryStore.delete?.(input.id);
      const content = input.content ?? '';
      await memoryStore.save({
        id: input.id, scope: 'global', title: content.slice(0, 80),
        summary: content, tags: input.tags ?? [], updatedAt: Date.now(), type: 'user',
      });
      return { id: input.id, content, tags: input.tags ?? [], createdAt: Date.now() };
    } catch (e) { log('error', 'updateMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:deleteMemory', async (_event, id: string) => {
    try { return await memoryStore.delete?.(id) ?? false; }
    catch (e) { log('error', 'deleteMemory failed', e); throw e; }
  });
  ipcMain.handle('desktop:importMemories', async (_event, raw: string) => {
    try {
      const { items, errors } = parseMemories(raw);
      if (items.length === 0 && errors.length === 0) return { imported: 0, deduped: 0, parseErrors: ['未解析到任何记忆'] };
      let imported = 0;
      for (const item of items) {
        const content = (item.content || '').trim();
        if (!content) continue;
        await memoryStore.save({
          id: `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          scope: 'global', title: content.slice(0, 80),
          summary: content, tags: item.tags || [], updatedAt: Date.now(), type: 'user',
        });
        imported++;
      }
      return { imported, deduped: 0, parseErrors: errors };
    } catch (e) {
      return { imported: 0, deduped: 0, parseErrors: [`导入失败: ${e}`] };
    }
  });
  ipcMain.handle('desktop:memoryStats', async () => {
    try { return memoryStore.getStats?.() ?? null; }
    catch (e) { log('error', 'memoryStats failed', e); return null; }
  });
  ipcMain.handle('desktop:memoryCompact', async () => {
    try { await memoryStore.compact?.(); return true; }
    catch (e) { log('error', 'memoryCompact failed', e); return false; }
  });
  ipcMain.handle('desktop:memoryPersonaTraits', async () => {
    try { return memoryStore.getPersonaTraits?.() ?? []; }
    catch (e) { log('error', 'memoryPersonaTraits failed', e); return []; }
  });
  ipcMain.handle('desktop:memoryListLayer', async (_event, layer: number, limit?: number, offset?: number) => {
    try { return memoryStore.listLayer?.(layer, limit ?? 50, offset ?? 0) ?? []; }
    catch (e) { log('error', 'memoryListLayer failed', e); return []; }
  });
  ipcMain.handle('desktop:memoryDeleteEntry', async (_event, id: string, layer: number) => {
    try { return await memoryStore.delete?.(id, layer) ?? false; }
    catch (e) { log('error', 'memoryDeleteEntry failed', e); return false; }
  });
  ipcMain.handle('desktop:memoryClearAll', async () => {
    try { memoryStore.clearAll?.(); return true; }
    catch (e) { log('error', 'memoryClearAll failed', e); return false; }
  });
  ipcMain.handle('desktop:memoryGetModelId', async () => {
    try {
      const config = await (await import('../../src/utils/config.js')).loadConfig();
      return config.memory?.modelId ?? null;
    } catch { return null; }
  });
  ipcMain.handle('desktop:memorySetModelId', async (_event, modelId: string | null) => {
    try {
      const { loadConfig, saveConfig: saveConfigFn } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      if (!config.memory) config.memory = {};
      config.memory.modelId = modelId ?? undefined;
      await saveConfigFn(config);
      return true;
    } catch (e) { log('error', 'memorySetModelId failed', e); return false; }
  });

  ipcMain.handle('desktop:getEmbeddingModels', async () => {
    try {
      const { MODEL_REGISTRY, isModelDownloaded, getManualDownloadHint } = await import('../../src/ai/memory/model-registry.js');
      const { loadConfig } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      const activeModelId = config.memory?.modelId ?? 'all-MiniLM-L6-v2';
      return MODEL_REGISTRY.map(m => ({
        id: m.id,
        name: m.name,
        dims: m.dims,
        size: m.size,
        languages: m.languages,
        downloaded: isModelDownloaded(m.id),
        active: m.id === activeModelId,
        manualHint: getManualDownloadHint(m.id),
      }));
    } catch (e) { log('error', 'getEmbeddingModels failed', e); return []; }
  });

  ipcMain.handle('desktop:downloadEmbeddingModel', async (_event, modelId: string) => {
    const { downloadModel } = await import('../../src/ai/memory/model-registry.js');
    await downloadModel(modelId);
  });

  ipcMain.handle('desktop:setEmbeddingModel', async (_event, modelId: string) => {
    try {
      const { loadConfig, saveConfig: saveConfigFn, getConfigDir } = await import('../../src/utils/config.js');
      const config = await loadConfig();
      const prevModelId = config.memory?.modelId;
      if (!config.memory) config.memory = {};
      config.memory.modelId = modelId;
      await saveConfigFn(config);
      if (prevModelId !== modelId) {
        try {
          const Database = (await import('better-sqlite3')).default;
          const path = await import('node:path');
          const dbPath = path.join(getConfigDir(), 'memory.db');
          const db = new Database(dbPath);
          db.prepare('DELETE FROM memory_embeddings').run();
          db.close();
          log('info', 'Cleared memory_embeddings after model switch', { from: prevModelId, to: modelId });
        } catch (e) { log('warn', 'Failed to clear embeddings on model switch', e); }
      }
    } catch (e) { log('error', 'setEmbeddingModel failed', e); throw e; }
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

  // ---- File Export ----
  ipcMain.handle('desktop:showSaveDialog', async (_event, input: { defaultPath?: string; filters?: Array<{ name: string; extensions: string[] }> }) => {
    log('info', 'showSaveDialog', { defaultPath: input?.defaultPath });
    const result = await dialog.showSaveDialog(window, {
      defaultPath: input?.defaultPath,
      filters: input?.filters ?? [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (result.canceled || !result.filePath) {
      log('info', 'showSaveDialog cancelled');
      return { canceled: true, filePath: '' };
    }
    log('info', 'showSaveDialog ok', { filePath: result.filePath });
    return { canceled: false, filePath: result.filePath };
  });

  ipcMain.handle('desktop:saveFile', async (_event, input: { filePath: string; content: string }) => {
    log('info', 'saveFile', { filePath: input?.filePath });
    try {
      const binaryContent = decodeBase64DataUrl(input.content);
      if (binaryContent) {
        await writeFile(input.filePath, binaryContent);
      } else {
        await writeFile(input.filePath, input.content, 'utf-8');
      }
      log('info', 'saveFile ok');
      return { success: true };
    } catch (e) {
      log('error', 'saveFile failed', String(e));
      return { success: false, error: String(e) };
    }
  });

  // ---- Project Principles ----
  const { PrinciplesStore } = await import('./principles-store.js');
  const principlesStore = new PrinciplesStore(services.getDataRoot());

  ipcMain.handle('desktop:listPrinciples', async () => {
    log('info', 'listPrinciples');
    return principlesStore.list();
  });

  ipcMain.handle('desktop:savePrinciple', async (_event, input) => {
    log('info', 'savePrinciple', { id: input?.id });
    const result = await principlesStore.save(input);
    log('info', 'savePrinciple result', result);
    return result;
  });

  ipcMain.handle('desktop:deletePrinciple', async (_event, id: string) => {
    log('info', 'deletePrinciple', { id });
    const result = await principlesStore.delete(id);
    log('info', 'deletePrinciple result', result);
    return result;
  });

  // ---- Knowledge Base ----
  const { createKbStoreSqlite } = await import('./kb-store-sqlite.js');
  const { createChunker } = await import('./kb-chunker.js');
  const { createSourceExtractor } = await import('./kb-source-extractor.js');
  const { app } = await import('electron');

  let kbStore: import('./kb-store.js').KbStore | null = null;
  function getKbStore() {
    if (!kbStore) {
      kbStore = createKbStoreSqlite(join(app.getPath('userData'), 'knowledge.db'));
      if (kbStore.listCollections().length === 0) {
        kbStore.createCollection({
          name: '我的知识库',
          description: '默认知识库集合',
          embeddingModelId: 'bge-small-zh-v1.5',
          embeddingDim: 512,
        });
      }
      (kbStore as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed' WHERE parse_status = 'pending' AND id IN (SELECT DISTINCT source_id FROM chunks)").run();
      const pendingSources = (kbStore as any)._db?.prepare("SELECT id, raw_path, mime_type FROM sources WHERE parse_status = 'pending' AND raw_path != ''").all() as Array<{ id: string; raw_path: string; mime_type: string }> | undefined;
      if (pendingSources?.length) {
        const store = kbStore!;
        setImmediate(async () => {
          const extractor = createSourceExtractor();
          const chunker = createChunker();
          for (const src of pendingSources) {
            try {
              const extractResult = await extractor.extract({ filePath: src.raw_path, mimeType: src.mime_type || 'application/octet-stream' });
              if (extractResult.ok && extractResult.text) {
                const chunks = chunker.chunk({ text: extractResult.text, mimeType: extractResult.mimeType });
                store.insertChunks(src.id, chunks);
                (store as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed', updated_at = ? WHERE id = ?").run(Date.now(), src.id);
              } else {
                (store as any)._db?.prepare("UPDATE sources SET parse_status = 'failed', updated_at = ? WHERE id = ?").run(Date.now(), src.id);
              }
            } catch {
              (store as any)._db?.prepare("UPDATE sources SET parse_status = 'failed', updated_at = ? WHERE id = ?").run(Date.now(), src.id);
            }
          }
        });
      }
    }
    return kbStore;
  }

  ipcMain.handle('desktop:kb:listCollections', async () => {
    log('info', 'kb:listCollections');
    return getKbStore().listCollections();
  });

  ipcMain.handle('desktop:kb:createCollection', async (_event, input) => {
    log('info', 'kb:createCollection', { name: input?.name });
    return getKbStore().createCollection(input);
  });

  ipcMain.handle('desktop:kb:deleteCollection', async (_event, id: string) => {
    log('info', 'kb:deleteCollection', { id });
    getKbStore().deleteCollection(id);
  });

  ipcMain.handle('desktop:kb:listSources', async (_event, collectionId: string) => {
    log('info', 'kb:listSources', { collectionId });
    return getKbStore().listSources(collectionId);
  });

  ipcMain.handle('desktop:kb:addSource', async (_event, input) => {
    log('info', 'kb:addSource', { kind: input?.kind, title: input?.title });
    const store = getKbStore();
    const source = store.addSource(input);
    const extractor = createSourceExtractor();
    const chunker = createChunker();
    try {
      let extractResult: { ok: boolean; text?: string; mimeType?: string } | null = null;
      if (input?.kind === 'paste' && input?.text) {
        extractResult = extractor.extractFromText(input.text, input.title || '粘贴文本');
      } else if (input?.kind === 'file' && input?.filePath) {
        extractResult = await extractor.extract({ filePath: input.filePath, mimeType: input.mimeType || 'application/octet-stream' });
      } else if (input?.kind === 'url' && input?.uri) {
        extractResult = await extractor.extractFromUrl(input.uri);
      }
      if (extractResult?.ok && extractResult.text) {
        const chunks = chunker.chunk({ text: extractResult.text, mimeType: extractResult.mimeType });
        store.insertChunks(source.id, chunks);
        (store as any)._db?.prepare("UPDATE sources SET parse_status = 'parsed', updated_at = ? WHERE id = ?").run(Date.now(), source.id);
      }
    } catch (e) {
      log('error', 'kb:addSource processing failed', String(e));
    }
    return source;
  });

  ipcMain.handle('desktop:kb:pickFiles', async () => {
    const { dialog } = await import('electron');
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '文档', extensions: ['pdf', 'txt', 'md', 'docx', 'pptx', 'xlsx', 'html', 'json', 'csv'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    });
    if (result.canceled) return [];
    return result.filePaths;
  });

  ipcMain.handle('desktop:kb:deleteSource', async (_event, id: string) => {
    log('info', 'kb:deleteSource', { id });
    getKbStore().deleteSource(id);
  });

  ipcMain.handle('desktop:kb:getCollectionState', async (_event, collectionId: string) => {
    log('info', 'kb:getCollectionState', { collectionId });
    return getKbStore().getCollectionState(collectionId);
  });

  ipcMain.handle('desktop:kb:search', async (_event, input) => {
    log('info', 'kb:search', { collectionId: input?.collectionId, query: input?.query?.slice(0, 50) });
    const store = getKbStore();
    const query = (input?.query ?? '').trim();
    const topK = input?.topK ?? 10;
    if (!query) return [];
    const collectionId = input?.collectionId ?? '';
    const sourceIds = input?.sourceIds as string[] | undefined;
    const allSources = store.listSources(collectionId);
    const filteredSources = sourceIds?.length ? allSources.filter(s => sourceIds.includes(s.id)) : allSources;
    const { segmentQuery } = await import('../../src/ai/memory/segment.js');
    const segmented = segmentQuery(query);
    const uniqueTerms = [...new Set(segmented.split(/\s+/).filter(Boolean).map((t: string) => t.toLowerCase()))];
    const results: Array<{ chunkId: string; sourceId: string; sourceTitle: string; collectionId: string; text: string; pageIndex: number | null; slideIndex: number | null; sheetName: string | null; bm25Score: number; vectorScore: number; fusedScore: number }> = [];
    for (const src of filteredSources) {
      const srcChunks = store.listChunks(src.id);
      for (const chunk of srcChunks) {
        const lower = chunk.text.toLowerCase();
        const matchCount = uniqueTerms.filter((t: string) => lower.includes(t)).length;
        if (matchCount > 0) {
          results.push({
            chunkId: chunk.id,
            sourceId: chunk.sourceId,
            sourceTitle: src.title,
            collectionId: chunk.collectionId,
            text: chunk.text,
            pageIndex: chunk.pageIndex,
            slideIndex: chunk.slideIndex,
            sheetName: chunk.sheetName,
            bm25Score: matchCount / uniqueTerms.length,
            vectorScore: 0,
            fusedScore: matchCount / uniqueTerms.length,
          });
        }
      }
    }
    results.sort((a, b) => b.fusedScore - a.fusedScore);
    return results.slice(0, topK);
  });
}

function getLoopRuntime(options: RegisterDesktopIpcOptions): NonNullable<RegisterDesktopIpcOptions['loopRuntime']> {
  if (!options.loopRuntime) {
    throw new Error('loop diagnostics runtime is not registered');
  }
  return options.loopRuntime;
}

function readLoopId(input: unknown): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('loopId must be a non-empty string');
  }
  return input;
}

async function openLoopOutputDirectory(loopId: string, template: UserLoopTemplate | undefined): Promise<Record<string, unknown>> {
  const target = resolveUserLoopOutputTarget(loopId, template);
  if (!target.ok) return target;
  try {
    await mkdir(target.outputDirectory, { recursive: true });
    const error = await shell.openPath(target.outputDirectory);
    if (error) {
      return { ok: false, loopId, error: 'open_output_directory_failed', message: error, pathLabel: target.outputDirectory };
    }
    return { ok: true, loopId, pathLabel: target.outputDirectory };
  } catch (error) {
    return {
      ok: false,
      loopId,
      error: 'open_output_directory_failed',
      message: error instanceof Error ? error.message : String(error),
      pathLabel: target.outputDirectory,
    };
  }
}

async function readLoopOutputPreview(loopId: string, template: UserLoopTemplate | undefined): Promise<Record<string, unknown>> {
  const target = resolveUserLoopOutputTarget(loopId, template);
  if (!target.ok) return target;
  try {
    const symlinkCheck = await lstat(target.outputPath);
    if (symlinkCheck.isSymbolicLink()) {
      return { ok: false, loopId, error: 'output_file_symlink', pathLabel: target.outputPath };
    }
    if (!symlinkCheck.isFile()) {
      return { ok: false, loopId, error: 'output_not_file', pathLabel: target.outputPath };
    }
    if (symlinkCheck.size > LOOP_OUTPUT_PREVIEW_LIMIT_BYTES) {
      return {
        ok: false,
        loopId,
        error: 'output_file_too_large',
        pathLabel: target.outputPath,
        sizeBytes: symlinkCheck.size,
        limitBytes: LOOP_OUTPUT_PREVIEW_LIMIT_BYTES,
      };
    }

    const file = await openFile(target.outputPath, 'r');
    try {
      const fileStat = await file.stat();
      if (!fileStat.isFile()) {
        return { ok: false, loopId, error: 'output_not_file', pathLabel: target.outputPath };
      }
      if (fileStat.size > LOOP_OUTPUT_PREVIEW_LIMIT_BYTES) {
        return {
          ok: false,
          loopId,
          error: 'output_file_too_large',
          pathLabel: target.outputPath,
          sizeBytes: fileStat.size,
          limitBytes: LOOP_OUTPUT_PREVIEW_LIMIT_BYTES,
        };
      }
      const buffer = Buffer.alloc(fileStat.size);
      if (fileStat.size > 0) {
        await file.read(buffer, 0, fileStat.size, 0);
      }
      if (looksBinary(buffer)) {
        return { ok: false, loopId, error: 'output_file_binary', pathLabel: target.outputPath, sizeBytes: fileStat.size };
      }
      return {
        ok: true,
        loopId,
        pathLabel: target.outputPath,
        content: buffer.toString('utf8'),
        sizeBytes: fileStat.size,
        truncated: false,
      };
    } finally {
      await file.close();
    }
  } catch (error) {
    const code = isRecord(error) && typeof error.code === 'string' ? error.code : '';
    if (code === 'ENOENT') {
      return { ok: false, loopId, error: 'missing_output_file', pathLabel: target.outputPath };
    }
    return {
      ok: false,
      loopId,
      error: 'read_output_preview_failed',
      message: error instanceof Error ? error.message : String(error),
      pathLabel: target.outputPath,
    };
  }
}

function resolveUserLoopOutputTarget(
  loopId: string,
  template: UserLoopTemplate | undefined,
): { ok: true; outputDirectory: string; outputPath: string } | { ok: false; loopId: string; error: string; message?: string; pathLabel?: string } {
  if (!template) return { ok: false, loopId, error: 'loop_not_found' };
  if (!isAbsolute(template.outputDirectory)) {
    return {
      ok: false,
      loopId,
      error: 'output_directory_relative_legacy',
      pathLabel: template.outputDirectory,
    };
  }
  if (!isSafeLoopOutputFileName(template.outputFileName)) {
    return {
      ok: false,
      loopId,
      error: 'output_file_name_invalid',
      pathLabel: template.outputFileName,
    };
  }
  const outputDirectory = resolve(template.outputDirectory);
  const outputPath = resolve(outputDirectory, template.outputFileName);
  if (dirname(outputPath) !== outputDirectory) {
    return {
      ok: false,
      loopId,
      error: 'output_file_escapes_directory',
      pathLabel: outputPath,
    };
  }
  return { ok: true, outputDirectory, outputPath };
}

function looksBinary(buffer: Buffer): boolean {
  return buffer.includes(0);
}

function readCreateUserLoopTemplateInput(input: unknown): CreateUserLoopTemplateInput {
  if (!isRecord(input)) {
    throw new Error('user loop template input must be an object');
  }
  if (input.kind !== 'markdown_file' && input.kind !== 'task_completion') {
    throw new Error('user loop template kind must be markdown_file or task_completion');
  }
  const base = {
    loopId: readLoopId(input.loopId),
    title: readNonEmptyString(input.title, 'title'),
    description: typeof input.description === 'string' ? input.description : undefined,
    prompt: readNonEmptyString(input.prompt, 'prompt'),
    now: Date.now(),
  };
  let result: CreateUserLoopTemplateInput;
  if (input.kind === 'task_completion') {
    result = { ...base, kind: 'task_completion' };
  } else {
    result = {
      ...base,
      kind: 'markdown_file',
      outputDirectory: readNonEmptyString(input.outputDirectory, 'outputDirectory'),
      outputFileName: readNonEmptyString(input.outputFileName, 'outputFileName'),
    };
  }
  if (Object.prototype.hasOwnProperty.call(input, 'scheduleEnabled')) {
    result.scheduleEnabled = input.scheduleEnabled === true;
  }
  if (isRecord(input.scheduleTrigger)) {
    result.scheduleTrigger = input.scheduleTrigger;
  }
  if (Object.prototype.hasOwnProperty.call(input, 'autoRunApproved')) {
    result.autoRunApproved = input.autoRunApproved === true;
  }
  return result;
}

function readNonEmptyString(input: unknown, fieldName: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === 'object' && input !== null && !Array.isArray(input);
}

async function expandSelectedMaterialPaths(paths: string[]): Promise<string[]> {
  const files: string[] = [];
  for (const path of paths) {
    try {
      const entry = await stat(path);
      if (entry.isFile()) {
        files.push(path);
      } else if (entry.isDirectory()) {
        files.push(...await listFilesInDirectory(path));
      }
    } catch {
      // Skip non-existent paths (e.g. pasted text that looks like a path)
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
