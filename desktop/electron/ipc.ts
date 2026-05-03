import { dialog, type BrowserWindow, type IpcMain } from 'electron';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { createDesktopServices } from './desktop-services.js';

type DesktopServices = ReturnType<typeof createDesktopServices>;

export function registerDesktopIpc(ipcMain: IpcMain, window: BrowserWindow, services: DesktopServices): void {
  ipcMain.handle('desktop:getModelConfig', () => services.getModelConfig());
  ipcMain.handle('desktop:saveModelConfig', (_event, input) => services.saveModelConfig(input));
  ipcMain.handle('desktop:selectMaterials', async () => {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
    });
    if (result.canceled) {
      return { filePaths: [] };
    }
    return { filePaths: await expandSelectedMaterialPaths(result.filePaths) };
  });
  ipcMain.handle('desktop:importMaterial', (_event, input) => services.importMaterial(input));
  ipcMain.handle('desktop:createTask', (_event, input) => services.createTask(input));
  ipcMain.handle('desktop:answerQuestion', (_event, input) => services.answerQuestion(input));
  ipcMain.handle('desktop:cancelTask', (_event, input) => services.cancelTask(input.taskId));
  ipcMain.handle('desktop:getActiveTask', () => services.getActiveTask());
  ipcMain.handle('desktop:recoverTask', (_event, input) => services.recoverTask(input.taskId));
  ipcMain.handle('desktop:openArtifact', (_event, input) => services.openArtifact(input.artifactId));
  ipcMain.handle('desktop:subscribeTask', async (_event, input) => {
    const taskId = input.taskId as string;
    void (async () => {
      for await (const event of services.subscribeTask(taskId)) {
        if (window.isDestroyed()) {
          break;
        }
        window.webContents.send(`desktop:taskEvent:${taskId}`, event);
      }
    })();
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
