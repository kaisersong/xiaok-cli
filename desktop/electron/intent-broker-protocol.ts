export const INTENT_BROKER_PROTOCOL = 'intent-broker';

interface ProtocolClientApp {
  isDefaultProtocolClient?: (protocol: string) => boolean;
  setAsDefaultProtocolClient: (protocol: string, path?: string, args?: string[]) => boolean;
  getAppPath?: () => string;
}

interface RegisterProtocolOptions {
  platform?: NodeJS.Platform;
  execPath?: string;
}

export function isIntentBrokerProtocolUrl(rawUrl: string): boolean {
  try {
    return new URL(rawUrl).protocol === `${INTENT_BROKER_PROTOCOL}:`;
  } catch {
    return false;
  }
}

export function findIntentBrokerProtocolUrl(argv: readonly string[]): string | null {
  return argv.find(isIntentBrokerProtocolUrl) ?? null;
}

function isElectronExecutable(execPath: string): boolean {
  return /(?:^|[\\/])electron(?:\.exe)?$/i.test(execPath);
}

export function registerIntentBrokerProtocolClient(
  app: ProtocolClientApp,
  options: RegisterProtocolOptions = {},
): boolean {
  const platform = options.platform ?? process.platform;
  if (platform !== 'win32') {
    return false;
  }

  try {
    if (app.isDefaultProtocolClient?.(INTENT_BROKER_PROTOCOL)) {
      return true;
    }

    const execPath = options.execPath ?? process.execPath;
    const appPath = app.getAppPath?.();
    if (appPath && isElectronExecutable(execPath)) {
      return app.setAsDefaultProtocolClient(INTENT_BROKER_PROTOCOL, execPath, [appPath]);
    }

    return app.setAsDefaultProtocolClient(INTENT_BROKER_PROTOCOL);
  } catch {
    return false;
  }
}
