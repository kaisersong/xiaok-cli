export const DEFAULT_DESKTOP_REMOTE_DEBUGGING_PORT = '9222';
export const DEFAULT_DESKTOP_REMOTE_DEBUGGING_ADDRESS = '127.0.0.1';

export type RemoteDebuggingConfigResult =
  | {
      enabled: true;
      port: string;
      address: string;
    }
  | {
      enabled: false;
      reason: 'explicit_remote_debugging_port';
    };

export interface RemoteDebuggingCommandLine {
  appendSwitch(name: string, value?: string): void;
  hasSwitch?(name: string): boolean;
}

function argvHasSwitch(argv: readonly string[], switchName: string): boolean {
  const prefix = `--${switchName}`;
  return argv.some((arg) => arg === prefix || arg.startsWith(`${prefix}=`));
}

export function configureDefaultRemoteDebugging(
  commandLine: RemoteDebuggingCommandLine,
  argv: readonly string[] = [],
): RemoteDebuggingConfigResult {
  const hasExplicitPort =
    Boolean(commandLine.hasSwitch?.('remote-debugging-port')) ||
    argvHasSwitch(argv, 'remote-debugging-port');

  if (hasExplicitPort) {
    return { enabled: false, reason: 'explicit_remote_debugging_port' };
  }

  commandLine.appendSwitch('remote-debugging-port', DEFAULT_DESKTOP_REMOTE_DEBUGGING_PORT);
  commandLine.appendSwitch('remote-debugging-address', DEFAULT_DESKTOP_REMOTE_DEBUGGING_ADDRESS);
  return {
    enabled: true,
    port: DEFAULT_DESKTOP_REMOTE_DEBUGGING_PORT,
    address: DEFAULT_DESKTOP_REMOTE_DEBUGGING_ADDRESS,
  };
}

