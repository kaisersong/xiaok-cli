import type { Command } from 'commander';
import { queryXiaokDaemonStatus, stopXiaokDaemon } from '../runtime/daemon/control.js';
import { XiaokDaemonHost } from '../runtime/daemon/host.js';
import { spawnXiaokDaemonDetached, waitForXiaokDaemon } from '../runtime/daemon/launcher.js';
import { resolveXiaokDaemonSocketPath } from '../runtime/reminder/ipc.js';
import { ReminderDaemonService } from '../runtime/reminder/daemon.js';

function resolveSocketPath(socketPath?: string): string {
  return socketPath?.trim() || resolveXiaokDaemonSocketPath();
}

export function registerDaemonCommands(program: Command): void {
  const daemon = program
    .command('daemon')
    .description('管理本地 xiaok daemon');

  daemon
    .command('serve')
    .option('--socket <path>', 'daemon socket / pipe path')
    .description('启动 xiaok daemon（前台运行）')
    .action(async (opts: { socket?: string }) => {
      const server = new XiaokDaemonHost({
        socketPath: resolveSocketPath(opts.socket),
        services: [new ReminderDaemonService()],
      });
      await server.start();

      const shutdown = async () => {
        await server.stop();
        process.exit(0);
      };

      process.once('SIGINT', () => {
        void shutdown();
      });
      process.once('SIGTERM', () => {
        void shutdown();
      });

      await new Promise(() => undefined);
    });

  daemon
    .command('status')
    .option('--socket <path>', 'daemon socket / pipe path')
    .description('查看 xiaok daemon 状态')
    .action(async (opts: { socket?: string }) => {
      const status = await queryXiaokDaemonStatus(resolveSocketPath(opts.socket));
      if (!status) {
        console.log('xiaok daemon: stopped');
        return;
      }
      console.log([
        'xiaok daemon: running',
        `socket: ${status.socketPath}`,
        `version: ${status.daemonVersion}`,
        `protocol: ${status.protocolVersion}`,
        `activeClients: ${status.activeClients}`,
        `activeSessions: ${status.activeSessions}`,
        `services: ${status.serviceNames.join(', ') || '(none)'}`,
      ].join('\n'));
    });

  daemon
    .command('start')
    .option('--socket <path>', 'daemon socket / pipe path')
    .description('后台启动 xiaok daemon')
    .action(async (opts: { socket?: string }) => {
      const socketPath = resolveSocketPath(opts.socket);
      const existing = await queryXiaokDaemonStatus(socketPath);
      if (existing?.running) {
        console.log('xiaok daemon already running');
        return;
      }
      await spawnXiaokDaemonDetached(socketPath);
      await waitForXiaokDaemon(socketPath);
      console.log('xiaok daemon started');
    });

  daemon
    .command('stop')
    .option('--socket <path>', 'daemon socket / pipe path')
    .description('停止 xiaok daemon')
    .action(async (opts: { socket?: string }) => {
      const stopped = await stopXiaokDaemon(resolveSocketPath(opts.socket));
      console.log(stopped ? 'xiaok daemon stopped' : 'xiaok daemon not running');
    });

  daemon
    .command('restart')
    .option('--socket <path>', 'daemon socket / pipe path')
    .description('重启 xiaok daemon')
    .action(async (opts: { socket?: string }) => {
      const socketPath = resolveSocketPath(opts.socket);
      await stopXiaokDaemon(socketPath);
      await spawnXiaokDaemonDetached(socketPath);
      await waitForXiaokDaemon(socketPath);
      console.log('xiaok daemon restarted');
    });

  daemon
    .command('update')
    .option('--socket <path>', 'daemon socket / pipe path')
    .description('刷新并重启 xiaok daemon')
    .action(async (opts: { socket?: string }) => {
      const socketPath = resolveSocketPath(opts.socket);
      await stopXiaokDaemon(socketPath);
      await spawnXiaokDaemonDetached(socketPath);
      await waitForXiaokDaemon(socketPath);
      console.log('xiaok daemon updated');
    });
}
