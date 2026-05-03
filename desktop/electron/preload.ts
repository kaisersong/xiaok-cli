import { contextBridge, ipcRenderer } from 'electron';
import { createPreloadApi } from './preload-api.js';

contextBridge.exposeInMainWorld('xiaokDesktop', createPreloadApi(ipcRenderer));
