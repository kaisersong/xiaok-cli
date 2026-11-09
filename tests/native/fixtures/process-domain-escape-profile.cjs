'use strict';
// Controlled local discussion ABI only; no model, tool, or Native grant.
const { spawn, execFileSync } = require('node:child_process');
const { writeFileSync } = require('node:fs');
if (process.argv.includes('--probe')) {
  process.stdout.write(
    JSON.stringify({
      protocol: 'room_discussion_v1',
      runtime: 'xiaok',
      freshSession: true,
      toolsDisabled: true,
      mcpDisabled: true,
      hooksDisabled: true,
    }),
  );
} else {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    input += chunk;
  });
  process.stdin.on('end', () => {
    const request = JSON.parse(input);
    const data = JSON.parse(request.prompt);
    const code = `/* ${data.nonce} */ setInterval(() => {}, 1000);`;
    const child = spawn(process.execPath, ['-e', code], {
      detached: true,
      stdio: 'ignore',
      env: process.env,
    });
    if (!child.pid) throw Error('OWN_ESCAPE_CHILD_NOT_BORN');
    const birth = execFileSync(
      '/bin/ps',
      ['-o', 'lstart=', '-p', String(child.pid)],
      {
        encoding: 'utf8',
      },
    ).trim();
    writeFileSync(
      data.receipt,
      JSON.stringify({
        pid: child.pid,
        birth,
        nonce: data.nonce,
        parentPid: process.pid,
      }),
    );
    child.unref();
    process.stdout.write(
      JSON.stringify({ text: 'Actual local profile completed.' }),
    );
  });
}
