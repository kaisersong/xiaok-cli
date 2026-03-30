const childProcess = require('node:child_process');

const originalExec = childProcess.exec;

childProcess.exec = function patchedExec(command, ...args) {
  if (typeof command === 'string' && command.trim().toLowerCase() === 'net use') {
    const callback = args.find((arg) => typeof arg === 'function');
    if (callback) {
      process.nextTick(() => callback(null, '', ''));
    }

    return {
      pid: 0,
      kill() {
        return true;
      },
    };
  }

  return originalExec.call(this, command, ...args);
};
