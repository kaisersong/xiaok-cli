import { app, BrowserWindow, ipcMain } from 'electron';
import { mkdirSync, readFileSync, appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const compiled = join(desktop, 'dist', 'main', 'desktop', 'electron');
const root = process.env.XIAOK_MULTI_AGENT_E2E_ROOT;
if (!root || !process.env.XIAOK_E2E_USER_DATA || !process.env.XIAOK_CONFIG_DIR) throw new Error('isolated E2E paths are required');
mkdirSync(process.env.XIAOK_E2E_USER_DATA, { recursive: true }); app.setPath('userData', process.env.XIAOK_E2E_USER_DATA);
// Fail before construction when an older build would ignore the isolated KB path.
if (!readFileSync(join(compiled, 'desktop-services.js'), 'utf8').includes('options.knowledgeDbPath')) throw new Error('rebuild Desktop main: isolated KB path is absent');
const load = name => import(pathToFileURL(join(compiled, `${name}.js`)).href);
const { createDesktopServices } = await load('desktop-services');
const { registerDesktopIpc } = await load('ipc');
const { buildBrowserWindowOptions, isTrustedDesktopRendererUrl } = await load('security');
const { DesktopApplicationWindowOwner } = await load('desktop-application-window-owner');
const { registerKSwarmProxy } = await load('kswarm-ipc-proxy');
const { KSwarmStreamBridge } = await load('kswarm-stream-bridge');
const rendererFile = join(desktop, 'dist', 'renderer', 'index.html');
let window; let services; let quitting = false;
let releaseCleanup = () => {};
let holdContent = false;
let releaseContent = () => {};
const contentReads = [];
const disposers = [];
const log = (...parts) => appendFileSync(join(root, 'electron.log'), `${parts.map(part => typeof part === 'string' ? part : JSON.stringify(part)).join(' ')}\n`);
app.on('render-process-gone', (_event, _contents, details) => log('render-process-gone', details));
app.on('child-process-gone', (_event, details) => log('child-process-gone', details));
// Observe the real handler result; preserve its timing, return and rejection.
// This probe explains failures without treating every rejection as lost ACK.
const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => registerHandler(channel, async (event, ...args) => {
  const control = /desktop:(sendAgentMessage|followupAgent|interruptAgent|closeAgent)$/.test(channel);
  try {
    const result = await listener(event, ...args);
    if (channel === 'desktop:getAgentContent') {
      contentReads.push({ contentId: args[0]?.contentId, offset: args[0]?.offset, nextOffset: result.nextOffset });
      // Only delay the real handler's response; never fabricate content or its
      // authorization result. This models another window changing the turn.
      if (holdContent) {
        holdContent = false;
        await new Promise(resolve => { releaseContent = resolve; });
      }
    }
    if (control) log('control', channel, { operationId: args[0]?.operationId, expectedTurn: args[0]?.expectedTurn, result });
    return result;
  } catch (error) {
    if (control) log('control-rejected', channel, { operationId: args[0]?.operationId, expectedTurn: args[0]?.expectedTurn, error: String(error) });
    throw error;
  }
});
process.on('uncaughtException', error => { log('uncaught', String(error), error.stack); app.exit(1); });
process.on('unhandledRejection', error => { log('unhandled', String(error)); });
const kswarm = { start: async () => {}, stop: async () => {}, restart: async () => {}, onStatusChange: () => () => {},
  getStatus: () => ({ running: false, port: 0, pid: null, restartCount: 0, lastError: null }), getDesktopMutationToken: () => 'fixture',
  getIntentBrokerRoomToken: () => 'fixture', request: async () => new Response('{}', { status: 503 }) };

async function createView() {
  window = new BrowserWindow({ ...buildBrowserWindowOptions(join(compiled, 'preload.cjs')), show: true, width: 1440, height: 940 });
  window.webContents.on('console-message', (_event, level, message) => log('renderer', level, message));
  window.on('closed', () => { window = undefined; });
  await window.loadFile(rendererFile); return window;
}
const owner = new DesktopApplicationWindowOwner({ current: () => window && !window.isDestroyed() ? window : null,
  bootstrap: async () => {
    services = createDesktopServices({ dataRoot: join(root, 'data'), knowledgeDbPath: join(root, 'knowledge.sqlite'), workspaceRoot: join(root, 'workspace'),
      pluginRootDir: join(root, 'plugins'), pluginDependencies: [], kswarmService: kswarm });
    await services.saveModelConfig({ providerId: 'e2e-local', modelName: 'e2e-model', protocol: 'openai_legacy', baseUrl: process.env.XIAOK_MULTI_AGENT_E2E_PROVIDER, apiKey: 'e2e-fixture-only' });
    await services.multiAgent.ready;
    // The unrelated KSwarm port stays disconnected in this isolated fixture;
    // register its real semantic proxy so AppLayout does not see missing IPC.
    const bridge = new KSwarmStreamBridge('ws://127.0.0.1:0/ws');
    registerKSwarmProxy(ipcMain, bridge, kswarm); disposers.push(() => bridge.dispose());
    // Register against the actual window before renderer startup can invoke IPC.
    window = new BrowserWindow({ ...buildBrowserWindowOptions(join(compiled, 'preload.cjs')), show: true, width: 1440, height: 940 });
    window.webContents.on('console-message', (_event, level, message) => log('renderer', level, message));
    window.on('closed', () => { window = undefined; });
    await registerDesktopIpc(ipcMain, window, services, { getMainWindow: () => window, registerLifetimeDisposer: dispose => disposers.push(dispose),
      multiAgentAuthorize: event => window && !window.isDestroyed() && event.sender === window.webContents
        && event.senderFrame === window.webContents.mainFrame && isTrustedDesktopRendererUrl(window.webContents.mainFrame.url, { rendererFile })
        ? { actorId: `desktop-user:${services.multiAgent.profileId}` } : null });
    // GeneralPane also uses these two read-only handlers registered directly
    // by production main.ts, not by registerDesktopIpc. Delegate to the actual
    // service getters, which read this fixture's isolated XIAOK_CONFIG_DIR.
    ipcMain.handle('desktop:getSkillDebugConfig', () => services.getSkillDebugConfig());
    ipcMain.handle('desktop:getKswarmConfig', () => services.getKswarmConfig());
    await window.loadFile(rendererFile); log('ready'); return window;
  }, createView });
globalThis.multiAgentE2E = {
  reopen: async () => { window?.destroy(); return owner.open(); }, getServices: () => services,
  holdNextContent: () => { holdContent = true; },
  releaseContent: () => releaseContent(),
  contentReads: () => [...contentReads],
  holdNextCleanup: () => {
    const pending = new Promise(resolve => { releaseCleanup = resolve; });
    const options = services.multiAgent.service.options, create = options.createSession;
    // External cleanup completion is the sole fault-injection boundary. The
    // real runtime, provider, session, service and coordinator remain in use.
    options.createSession = async input => {
      options.createSession = create;
      const session = await create(input), dispose = session.dispose.bind(session);
      session.dispose = async () => { await pending; await dispose(); };
      return session;
    };
  },
  releaseCleanup: () => releaseCleanup(),
};
// Match the macOS application owner: closing its last view does not quit the
// application or cancel work. The test explicitly closes its app in finally.
app.on('window-all-closed', () => {});
app.whenReady().then(() => owner.open()).catch(error => { log('startup failed', String(error), error.stack); app.exit(1); });
app.on('before-quit', event => {
  if (quitting) return; event.preventDefault(); quitting = true;
  releaseCleanup();
  releaseContent();
  void services?.disposeMultiAgent().finally(() => { for (const dispose of disposers) dispose(); app.exit(0); });
});
