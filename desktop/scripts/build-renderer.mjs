import { EventEmitter } from 'node:events';
import childProcess from 'node:child_process';
import module from 'node:module';

function cannotSpawnNode() {
  const result = childProcess.spawnSync(process.execPath, ['-v'], { encoding: 'utf8' });
  return result.error?.code === 'EPERM';
}

function patchViteWindowsNetUseProbe() {
  const originalExec = childProcess.exec;
  childProcess.exec = function patchedExec(command, options, callback) {
    if (typeof options === 'function') {
      callback = options;
      options = undefined;
    }

    if (String(command).trim().toLowerCase() === 'net use') {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = () => true;
      process.nextTick(() => {
        callback?.(null, '', '');
        child.emit('exit', 0);
        child.emit('close', 0);
      });
      return child;
    }

    return originalExec.call(this, command, options, callback);
  };
  module.syncBuiltinESMExports();
}

const args = ['node', 'vite', 'build'];

if (cannotSpawnNode()) {
  patchViteWindowsNetUseProbe();
  args.push('--config', 'vite.config.no-esbuild.mjs', '--configLoader', 'runner');
}

process.argv = args;
await import('../node_modules/vite/bin/vite.js');
