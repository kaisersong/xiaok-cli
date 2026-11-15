#!/usr/bin/env python3
"""Real POSIX PTY: raw input survives an internal reader's delayed handoff."""
import os
from pathlib import Path
import pty
import select
import subprocess
import sys
import time

module = Path(sys.argv[1]).resolve().as_uri()
program = f"""
import {{retainRawInputModeForSession,pauseInputForHandoff}} from {module!r};
const release=retainRawInputModeForSession();
process.stdin.setRawMode(true);
pauseInputForHandoff();
console.log('HANDOFF_RAW='+process.stdin.isRaw);
setTimeout(()=>{{
 process.stdin.setRawMode(true);
 process.stdin.once('data',data=>{{
  console.log('RECEIVED='+JSON.stringify(data.toString()));
  process.stdin.pause();release();process.exit(0);
 }});
 process.stdin.resume();
}},200);
setTimeout(()=>process.exit(3),3000);
"""
master, slave = pty.openpty()
child = subprocess.Popen(['node', '--input-type=module', '-e', program], stdin=slave,
                         stdout=slave, stderr=slave)
os.close(slave)
output = b''
sent = False
try:
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if select.select([master], [], [], .05)[0]:
            try:
                data = os.read(master, 65536)
            except OSError:
                break
            if not data:
                break
            output += data
            if b'HANDOFF_RAW=' in output and not sent:
                os.write(master, b'hello\r')
                sent = True
        if child.poll() is not None:
            break
    assert child.wait(timeout=1) == 0, output
    assert b'HANDOFF_RAW=true' in output, output
    assert b'RECEIVED="hello\\r"' in output, output
    print('real PTY delayed raw input handoff: passed')
finally:
    if child.poll() is None:
        child.kill()
        child.wait()
    os.close(master)
