import { win32 as path } from 'node:path';

function fail() { throw new Error('PRODUCT_EVAL_WINDOWS_LAUNCH_CONTRACT_INVALID'); }
function localPath(value) {
  if (typeof value !== 'string' || !/^[a-z]:[\\/]/i.test(value) || value.includes('\0')) fail();
  return path.normalize(value);
}
function childPath(root, value) {
  const normalized = localPath(value);
  const relative = path.relative(root.toLowerCase(), normalized.toLowerCase());
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail();
  return normalized;
}

/** Pure launch specification for an already isolated Windows QA guest.
 * This does not create a sandbox or authorize launching on the user's host.
 * The guest runner must verify package hashes, real paths, process/port
 * ownership, and the disposable-environment identity before spawning it.
 * systemRoot must be the verified guest OS install root; this parameter does
 * not select or authorize an execution environment.
 */
export function createWindowsProductLaunch({
  appPath,
  session,
  platform = process.platform,
  systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
}) {
  if (platform !== 'win32') throw new Error('PRODUCT_EVAL_WINDOWS_ONLY');
  const command = localPath(appPath);
  if (path.basename(command).toLowerCase() !== 'xiaok.exe') fail();
  const root = localPath(session?.sessionRoot);
  childPath(root, command);
  const paths = Object.fromEntries(['userData', 'home', 'config', 'temp', 'workspace', 'logs']
    .map(name => [name, childPath(root, session?.[name])]));
  if (new Set(Object.values(paths).map(value => value.toLowerCase())).size !== Object.keys(paths).length) fail();
  const port = session?.debuggingPort;
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) fail();
  const windows = localPath(systemRoot);
  const services = path.join(root, 'services');
  const broker = path.join(services, 'intent-broker');
  const env = Object.freeze({
    HOME: paths.home,
    USERPROFILE: paths.home,
    APPDATA: path.join(paths.home, 'AppData', 'Roaming'),
    LOCALAPPDATA: path.join(paths.home, 'AppData', 'Local'),
    XIAOK_CONFIG_DIR: paths.config,
    TEMP: paths.temp,
    TMP: paths.temp,
    XDG_CONFIG_HOME: path.join(paths.home, '.config'),
    XDG_CACHE_HOME: path.join(paths.home, '.cache'),
    XDG_DATA_HOME: path.join(paths.home, '.local', 'share'),
    KSWARM_DATA_ROOT: path.join(services, 'kswarm'),
    INTENT_BROKER_DB: path.join(broker, '.tmp', 'intent-broker.db'),
    INTENT_BROKER_LOCAL_CONFIG: path.join(broker, 'intent-broker.local.json'),
    INTENT_BROKER_HEARTBEAT_PATH: path.join(broker, '.tmp', 'broker.heartbeat.json'),
    XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
    SystemRoot: windows,
    WINDIR: windows,
    ComSpec: path.join(windows, 'System32', 'cmd.exe'),
    PATH: [path.join(windows, 'System32'), path.join(windows, 'System32', 'WindowsPowerShell', 'v1.0')].join(path.delimiter),
    LANG: 'C.UTF-8',
  });
  return Object.freeze({
    command,
    args: Object.freeze([
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${paths.userData}`,
    ]),
    cwd: paths.workspace,
    env,
  });
}
