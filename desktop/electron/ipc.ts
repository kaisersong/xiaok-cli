import { dialog, type BrowserWindow, type IpcMain } from 'electron';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { createDesktopServices } from './desktop-services.js';

type DesktopServices = ReturnType<typeof createDesktopServices>;

function log(level: string, msg: string, ...args: unknown[]) {
  const ts = new Date().toISOString();
  const payload = args.length ? ' ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ') : '';
  console.log(`[${ts}] [${level}] [ipc] ${msg}${payload}`);
}

export function registerDesktopIpc(ipcMain: IpcMain, window: BrowserWindow, services: DesktopServices): void {
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
  ipcMain.handle('desktop:subscribeTask', async (_event, input) => {
    const taskId = input.taskId as string;
    log('info', 'subscribeTask', { taskId });
    void (async () => {
      try {
        for await (const event of services.subscribeTask(taskId)) {
          if (window.isDestroyed()) {
            break;
          }
          window.webContents.send(`desktop:taskEvent:${taskId}`, event);
        }
        log('info', 'subscribeTask stream ended', { taskId });
      } catch (e) {
        log('error', 'subscribeTask error', { taskId, message: String(e) });
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
  ipcMain.handle('desktop:createTaskWithFiles', async (_event, input) => {
    log('info', 'createTaskWithFiles', { prompt: input?.prompt?.slice(0, 50), files: input?.filePaths?.length });
    const r = await services.createTaskWithFiles(input);
    log('info', 'createTaskWithFiles ok', { taskId: r?.taskId });
    return r;
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
