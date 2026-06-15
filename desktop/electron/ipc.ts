import { clipboard, dialog, shell, type BrowserWindow, type IpcMain } from 'electron';
import { mkdir, open, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { basename, extname, isAbsolute, join, resolve } from 'node:path';
import type { createDesktopServices } from './desktop-services.js';
import type { DesktopLoopRuntime } from './loop-executor.js';
import type { TimedActionService } from './timed-action-service.js';
import type { TimedActionTrigger } from './timed-action-types.js';

type DesktopServices = ReturnType<typeof createDesktopServices>;

interface RegisterDesktopIpcOptions {
  loopRuntime?: Pick<DesktopLoopRuntime, 'loopStore' | 'scanner' | 'runner' | 'listAnomalies'>;
  timedActionService?: Pick<TimedActionService,
    'createLoopSchedule' |
    'updateLoopSchedule' |
    'cancelLoopSchedule' |
    'approveAuto' |
    'revokeAuto'
  >;
}

function log(level: string, msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const payload = args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
  console.log(`[${ts}] [${level}] [ipc] ${msg}${payload}`);
}

const LOCAL_ARTIFACT_PREVIEW_MAX_BYTES = 512 * 1024;

const LOCAL_ARTIFACT_MIME_TYPES: Record<string, string> = {
  '.css': 'text/css',
  '.csv': 'text/csv',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.jsx': 'text/javascript',
  '.log': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.mjs': 'text/javascript',
  '.svg': 'image/svg+xml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.txt': 'text/plain',
  '.xml': 'application/xml',
  '.yaml': 'application/yaml',
  '.yml': 'application/yaml',
};

function normalizeAbsoluteLocalPath(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('invalid_path');
  }
  const filePath = value.trim();
  if (!isAbsolute(filePath)) {
    throw new Error('path_must_be_absolute');
  }
  return resolve(filePath);
}

function mimeTypeForLocalArtifact(filePath: string): string | null {
  return LOCAL_ARTIFACT_MIME_TYPES[extname(filePath).toLowerCase()] ?? null;
}

async function readLocalArtifactPreview(filePathInput: unknown) {
  const filePath = normalizeAbsoluteLocalPath(filePathInput);
  const mimeType = mimeTypeForLocalArtifact(filePath);
  if (!mimeType) {
    throw new Error('unsupported_file_type');
  }
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) {
    throw new Error('not_a_file');
  }

  const bytesToRead = Math.min(fileStat.size, LOCAL_ARTIFACT_PREVIEW_MAX_BYTES);
  let content = '';
  if (bytesToRead > 0) {
    const handle = await open(filePath, 'r');
    try {
      const buffer = Buffer.alloc(bytesToRead);
      const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
      content = buffer.subarray(0, bytesRead).toString('utf8');
    } finally {
      await handle.close();
    }
  }
  if (content.includes('\u0000')) {
    throw new Error('unsupported_binary_file');
  }

  return {
    path: filePath,
    fileName: basename(filePath),
    mimeType,
    sizeBytes: fileStat.size,
    modifiedAt: fileStat.mtimeMs,
    content,
    truncated: fileStat.size > LOCAL_ARTIFACT_PREVIEW_MAX_BYTES,
  };
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
  ipcMain.handle('desktop:openLocalPath', async (_event, input) => {
    try {
      const filePath = normalizeAbsoluteLocalPath(input?.filePath);
      log('info', 'openLocalPath', { filePath });
      const error = await shell.openPath(filePath);
      if (error) {
        log('warn', 'openLocalPath failed', { filePath, error });
        return { ok: false, error };
      }
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      log('warn', 'openLocalPath rejected', { error });
      return { ok: false, error };
    }
  });
  ipcMain.handle('desktop:readLocalArtifactPreview', async (_event, input) => {
    const filePath = input?.filePath as string;
    log('info', 'readLocalArtifactPreview', { filePath });
    return readLocalArtifactPreview(filePath);
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
  ipcMain.handle('desktop:loops:listRuns', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listLoopRuns(readLoopId(loopId), 20);
  });
  ipcMain.handle('desktop:loops:listAnomalies', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.listAnomalies(readLoopId(loopId));
  });
  ipcMain.handle('desktop:loops:runNow', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.runner.runLoopNow(readLoopId(loopId));
  });
  ipcMain.handle('desktop:loops:listUserTemplates', () => {
    const loopRuntime = getLoopRuntime(options);
    return loopRuntime.loopStore.listUserLoopTemplates().map(userLoopTemplateView);
  });
  ipcMain.handle('desktop:loops:createUserTemplate', (_event, input) => {
    const loopRuntime = getLoopRuntime(options);
    const normalized = readUserLoopTemplateInput(input);
    const created = loopRuntime.loopStore.createUserLoopTemplate(normalized);
    const withSchedule = bindUserLoopSchedule({
      loopRuntime,
      timedActionService: options.timedActionService,
      loopId: created.definition.id,
      title: normalized.title,
      description: normalized.description,
      scheduleEnabled: normalized.scheduleEnabled ?? false,
      scheduleTrigger: normalized.scheduleTrigger,
      scheduleActionId: created.template.scheduleActionId,
      autoRunApproved: created.template.autoRunApproved,
    });
    return userLoopTemplateView({
      definition: created.definition,
      template: withSchedule ?? created.template,
    });
  });
  ipcMain.handle('desktop:loops:updateUserTemplate', (_event, input) => {
    const loopRuntime = getLoopRuntime(options);
    const normalized = readUserLoopTemplateInput(input, { requireLoopId: true });
    const existing = loopRuntime.loopStore.getUserLoopTemplate(normalized.loopId);
    const updated = loopRuntime.loopStore.updateUserLoopTemplate(normalized);
    if (!updated) return null;
    const withSchedule = bindUserLoopSchedule({
      loopRuntime,
      timedActionService: options.timedActionService,
      loopId: updated.definition.id,
      title: normalized.title,
      description: normalized.description,
      scheduleEnabled: updated.template.scheduleEnabled,
      scheduleTrigger: normalized.scheduleTrigger ?? readStoredScheduleTrigger(updated.template.scheduleTrigger),
      scheduleActionId: existing?.scheduleActionId,
      autoRunApproved: updated.template.autoRunApproved,
    });
    return userLoopTemplateView({
      definition: updated.definition,
      template: withSchedule ?? updated.template,
    });
  });
  ipcMain.handle('desktop:loops:deleteUserTemplate', (_event, loopId) => {
    const loopRuntime = getLoopRuntime(options);
    const id = readLoopId(loopId);
    const existing = loopRuntime.loopStore.getUserLoopTemplate(id);
    const result = loopRuntime.loopStore.deleteUserLoopTemplate(id, Date.now());
    if (result.ok && existing?.scheduleActionId) {
      options.timedActionService?.cancelLoopSchedule(existing.scheduleActionId, 'user loop template deleted');
    }
    return result;
  });
  ipcMain.handle('desktop:loops:setUserTemplateAutoRunApproved', (_event, input) => {
    const loopRuntime = getLoopRuntime(options);
    const loopId = readLoopId(input?.loopId);
    const approved = Boolean(input?.approved);
    const template = loopRuntime.loopStore.setUserLoopAutoRunApproved(loopId, approved, Date.now());
    if (!template) return null;
    if (template.scheduleActionId) {
      if (approved) options.timedActionService?.approveAuto(template.scheduleActionId);
      else options.timedActionService?.revokeAuto(template.scheduleActionId);
    }
    const definition = loopRuntime.loopStore.getLoopDefinition(loopId);
    return definition ? userLoopTemplateView({ definition, template }) : null;
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
      await writeFile(input.filePath, input.content, 'utf-8');
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

interface NormalizedUserLoopTemplateIpcInput {
  loopId: string;
  title: string;
  description: string;
  kind: 'markdown_file';
  prompt: string;
  outputDirectory: string;
  outputFileName: string;
  scheduleEnabled?: boolean;
  scheduleTrigger?: TimedActionTrigger;
  scheduleActionId?: string;
  autoRunApproved?: boolean;
}

function readUserLoopTemplateInput(input: unknown, options: { requireLoopId?: boolean } = {}): NormalizedUserLoopTemplateIpcInput {
  if (!isRecord(input)) throw new Error('user loop template input must be an object');
  const loopId = options.requireLoopId ? readLoopId(input.loopId) : String(input.loopId ?? '');
  const title = readNonEmptyString(input.title, 'title');
  const kind = input.kind === 'markdown_file' ? input.kind : undefined;
  if (!kind) throw new Error('kind must be markdown_file');
  const prompt = readNonEmptyString(input.prompt, 'prompt');
  const outputDirectory = readNonEmptyString(input.outputDirectory, 'outputDirectory');
  const outputFileName = readNonEmptyString(input.outputFileName, 'outputFileName');
  const scheduleTrigger = input.scheduleTrigger === undefined ? undefined : readScheduleTrigger(input.scheduleTrigger);
  return {
    loopId,
    title,
    description: typeof input.description === 'string' ? input.description : '',
    kind,
    prompt,
    outputDirectory,
    outputFileName,
    scheduleEnabled: typeof input.scheduleEnabled === 'boolean' ? input.scheduleEnabled : undefined,
    scheduleTrigger,
    scheduleActionId: typeof input.scheduleActionId === 'string' ? input.scheduleActionId : undefined,
    autoRunApproved: typeof input.autoRunApproved === 'boolean' ? input.autoRunApproved : undefined,
  };
}

function bindUserLoopSchedule(input: {
  loopRuntime: NonNullable<RegisterDesktopIpcOptions['loopRuntime']>;
  timedActionService?: RegisterDesktopIpcOptions['timedActionService'];
  loopId: string;
  title: string;
  description: string;
  scheduleEnabled: boolean;
  scheduleTrigger?: TimedActionTrigger;
  scheduleActionId?: string;
  autoRunApproved?: boolean;
}) {
  if (!input.timedActionService) return undefined;
  if (!input.scheduleEnabled || !input.scheduleTrigger) {
    if (input.scheduleActionId) {
      input.timedActionService.cancelLoopSchedule(input.scheduleActionId, 'user loop schedule disabled');
    }
    return input.loopRuntime.loopStore.setUserLoopScheduleBinding(input.loopId, {
      scheduleEnabled: false,
      now: Date.now(),
    });
  }
  const action = input.scheduleActionId
    ? input.timedActionService.updateLoopSchedule({
      id: input.scheduleActionId,
      loopId: input.loopId,
      title: input.title,
      description: input.description,
      trigger: input.scheduleTrigger,
      userApprovedAuto: input.autoRunApproved ?? false,
    })
    : input.timedActionService.createLoopSchedule({
      loopId: input.loopId,
      title: input.title,
      description: input.description,
      trigger: input.scheduleTrigger,
      userApprovedAuto: input.autoRunApproved ?? false,
    });
  if (!action) return undefined;
  return input.loopRuntime.loopStore.setUserLoopScheduleBinding(input.loopId, {
    scheduleEnabled: true,
    scheduleActionId: action.id,
    scheduleTrigger: input.scheduleTrigger,
    now: Date.now(),
  });
}

function userLoopTemplateView(item: {
  definition: {
    id: string;
    title: string;
    description: string;
    status: string;
    origin?: string;
    activeRunId?: string;
    createdAt: number;
    updatedAt: number;
  };
  template: {
    loopId: string;
    kind: string;
    prompt: string;
    outputDirectory: string;
    outputFileName: string;
    scheduleActionId?: string;
    scheduleEnabled: boolean;
    scheduleTrigger?: Record<string, unknown>;
    autoRunApproved: boolean;
    createdAt: number;
    updatedAt: number;
  };
}) {
  return {
    loopId: item.definition.id,
    title: item.definition.title,
    description: item.definition.description,
    status: item.definition.status,
    origin: item.definition.origin,
    activeRunId: item.definition.activeRunId,
    kind: item.template.kind,
    prompt: item.template.prompt,
    outputDirectory: item.template.outputDirectory,
    outputFileName: item.template.outputFileName,
    outputPath: resolve(item.template.outputDirectory, item.template.outputFileName),
    scheduleActionId: item.template.scheduleActionId,
    scheduleEnabled: item.template.scheduleEnabled,
    scheduleTrigger: item.template.scheduleTrigger,
    autoRunApproved: item.template.autoRunApproved,
    createdAt: item.definition.createdAt,
    updatedAt: Math.max(item.definition.updatedAt, item.template.updatedAt),
  };
}

function readScheduleTrigger(input: unknown): TimedActionTrigger {
  if (!isRecord(input)) throw new Error('scheduleTrigger must be an object');
  if (input.kind === 'interval') {
    const intervalMinutes = Number(input.intervalMinutes);
    if (!Number.isFinite(intervalMinutes) || intervalMinutes <= 0) throw new Error('intervalMinutes must be positive');
    return { kind: 'interval', intervalMinutes };
  }
  if (input.kind === 'daily' || input.kind === 'weekdays') {
    const hour = Number(input.hour);
    const minute = Number(input.minute);
    if (!isHour(hour) || !isMinute(minute)) throw new Error('schedule hour/minute are invalid');
    return { kind: input.kind, hour, minute };
  }
  if (input.kind === 'weekly') {
    const dayOfWeek = Number(input.dayOfWeek);
    const hour = Number(input.hour);
    const minute = Number(input.minute);
    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) throw new Error('dayOfWeek must be 0-6');
    if (!isHour(hour) || !isMinute(minute)) throw new Error('schedule hour/minute are invalid');
    return { kind: 'weekly', dayOfWeek, hour, minute };
  }
  throw new Error('scheduleTrigger kind must be interval, daily, weekdays, or weekly');
}

function readStoredScheduleTrigger(input: Record<string, unknown> | undefined): TimedActionTrigger | undefined {
  return input ? readScheduleTrigger(input) : undefined;
}

function readNonEmptyString(input: unknown, name: string): string {
  if (typeof input !== 'string' || input.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return input;
}

function isHour(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 23;
}

function isMinute(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 59;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object';
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
