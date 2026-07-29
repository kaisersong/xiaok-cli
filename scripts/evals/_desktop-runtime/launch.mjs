import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const SESSION_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

function fail(code) {
  throw new Error(code);
}

/**
 * Creates an isolated per-session directory layout so the packaged app never
 * touches the developer's real profile. Mirrors the proven D9 pattern
 * (fresh user-data/home/config/temp/workspace/logs + injected XIAOK_CONFIG_DIR)
 * without importing any kimi-k3-d9 module.
 */
export async function materializeFreshProductSession({ runRoot, sessionId, debuggingPort }) {
  if (
    typeof runRoot !== 'string'
    || !isAbsolute(runRoot)
    || !SESSION_ID_PATTERN.test(sessionId ?? '')
    || !Number.isSafeInteger(debuggingPort)
    || debuggingPort < 1024
    || debuggingPort > 65535
  ) {
    fail('PRODUCT_EVAL_SESSION_LAYOUT_INVALID');
  }
  const sessionRoot = join(resolve(runRoot), 'sessions', sessionId);
  const paths = {
    userData: join(sessionRoot, 'user-data'),
    home: join(sessionRoot, 'home'),
    config: join(sessionRoot, 'config'),
    temp: join(sessionRoot, 'temp'),
    workspace: join(sessionRoot, 'workspace'),
    logs: join(sessionRoot, 'logs'),
  };
  for (const path of Object.values(paths)) {
    await mkdir(path, { recursive: true, mode: 0o700 });
  }
  return Object.freeze({
    sessionRoot,
    debuggingPort,
    ...paths,
    // The snapshot store lives under XIAOK_CONFIG_DIR/desktop at runtime.
    snapshotDir: join(paths.config, 'desktop', 'tasks', 'snapshots'),
  });
}

/**
 * Builds the launch spec for the packaged mac app. macOS-only by design
 * (the product eval MVP targets darwin/arm64, same as D9).
 */
export function createProductLaunch({ appPath, session }) {
  if (process.platform !== 'darwin') {
    fail('PRODUCT_EVAL_MACOS_ONLY');
  }
  if (
    typeof appPath !== 'string'
    || !isAbsolute(appPath)
    || !appPath.endsWith('.app')
    || !isAbsolute(session?.userData ?? '')
    || !isAbsolute(session?.home ?? '')
    || !isAbsolute(session?.config ?? '')
    || !Number.isSafeInteger(session?.debuggingPort)
  ) {
    fail('PRODUCT_EVAL_LAUNCH_CONTRACT_INVALID');
  }
  const resolvedApp = resolve(appPath);
  return Object.freeze({
    command: join(resolvedApp, 'Contents', 'MacOS', 'xiaok'),
    args: [
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${session.debuggingPort}`,
      `--user-data-dir=${session.userData}`,
    ],
    cwd: session.workspace,
    env: {
      HOME: session.home,
      XIAOK_CONFIG_DIR: session.config,
      TMPDIR: session.temp,
      TMP: session.temp,
      TEMP: session.temp,
      XDG_CONFIG_HOME: join(session.home, '.config'),
      XDG_CACHE_HOME: join(session.home, '.cache'),
      XDG_DATA_HOME: join(session.home, '.local', 'share'),
      XIAOK_DESKTOP_DISABLE_SINGLE_INSTANCE: '1',
      LANG: 'C.UTF-8',
      PATH: dirname(process.execPath),
    },
  });
}
