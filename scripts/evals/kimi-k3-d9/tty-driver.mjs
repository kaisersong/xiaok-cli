import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  open,
  stat,
} from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function fail(code) {
  throw new Error(code);
}

function sha256JsonString(value) {
  return createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

export class ReadinessGate {
  #workspace;
  #serverName;
  #expectedToolCount;
  #inputReady = false;
  #mcpReady = false;

  constructor({ workspace, serverName, expectedToolCount }) {
    if (
      typeof workspace !== 'string'
      || !isAbsolute(workspace)
      || typeof serverName !== 'string'
      || serverName.length === 0
      || !Number.isSafeInteger(expectedToolCount)
      || expectedToolCount <= 0
    ) {
      fail('KIMI_D9_MCP_READINESS_FAILED');
    }
    this.#workspace = workspace;
    this.#serverName = serverName;
    this.#expectedToolCount = expectedToolCount;
  }

  observeTranscript(event) {
    if (event?.type === 'input_read_attach') {
      this.#inputReady = true;
    }
  }

  observeCapabilityHealth(document) {
    const entries = Array.isArray(document?.entries)
      ? document.entries
      : [];
    const snapshots = entries
      .filter(entry => entry?.cwd === this.#workspace)
      .map(entry => entry?.snapshot)
      .filter(Boolean);
    const matches = snapshots.flatMap(snapshot => (
      Array.isArray(snapshot.capabilities) ? snapshot.capabilities : []
    )).filter(capability => (
      capability?.kind === 'mcp'
      && capability?.name === this.#serverName
    ));
    if (
      matches.some(capability => capability.status === 'degraded')
      || matches.length > 1
    ) {
      fail('KIMI_D9_MCP_READINESS_FAILED');
    }
    this.#mcpReady = matches.length === 1
      && matches[0].status === 'connected'
      && String(matches[0].detail ?? '').split(';')[0].trim()
        === `${this.#expectedToolCount} tools`;
  }

  get ready() {
    return this.#inputReady && this.#mcpReady;
  }
}

export class JsonlTailReader {
  #path;
  #offset = 0;
  #partial = Buffer.alloc(0);
  #maxPartialBytes;
  #maxReadBytes;

  constructor(path, {
    maxPartialBytes = 65_536,
    maxReadBytes = 1_048_576,
  } = {}) {
    if (
      typeof path !== 'string'
      || path.length === 0
      || !Number.isSafeInteger(maxPartialBytes)
      || maxPartialBytes <= 0
      || !Number.isSafeInteger(maxReadBytes)
      || maxReadBytes <= 0
    ) {
      fail('KIMI_D9_JSONL_READER_INVALID');
    }
    this.#path = path;
    this.#maxPartialBytes = maxPartialBytes;
    this.#maxReadBytes = maxReadBytes;
  }

  async readAvailable() {
    const metadata = await stat(this.#path).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!metadata) return [];
    if (metadata.size < this.#offset) {
      fail('KIMI_D9_JSONL_TRUNCATED');
    }
    const byteCount = metadata.size - this.#offset;
    if (byteCount > this.#maxReadBytes) {
      fail('KIMI_D9_JSONL_READ_LIMIT');
    }
    if (byteCount > 0) {
      const handle = await open(this.#path, 'r');
      try {
        const bytes = Buffer.alloc(byteCount);
        const { bytesRead } = await handle.read(
          bytes,
          0,
          byteCount,
          this.#offset,
        );
        if (bytesRead !== byteCount) {
          fail('KIMI_D9_JSONL_PARTIAL_READ');
        }
        this.#partial = Buffer.concat([this.#partial, bytes]);
        this.#offset += bytesRead;
      } finally {
        await handle.close();
      }
    }

    const events = [];
    let lineStart = 0;
    for (let index = 0; index < this.#partial.length; index += 1) {
      if (this.#partial[index] !== 0x0A) continue;
      const line = this.#partial.subarray(lineStart, index);
      lineStart = index + 1;
      if (line.length === 0) continue;
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(line);
        events.push(JSON.parse(text));
      } catch {
        fail('KIMI_D9_JSONL_INVALID');
      }
    }
    this.#partial = this.#partial.subarray(lineStart);
    if (this.#partial.length > this.#maxPartialBytes) {
      fail('KIMI_D9_JSONL_PARTIAL_LIMIT');
    }
    return events;
  }
}

export class TurnObservation {
  #marker;
  #validator;
  #submittedAtMs;
  #ttfvMs = null;
  #terminalAtMs = null;
  #readyAfterSubmitAtMs = null;
  #terminalStatus = null;
  #semanticPassed = false;
  #continuityPassed = false;
  #resultBuffer = '';

  constructor({
    marker,
    validator,
    submittedAtMs,
  }) {
    if (
      typeof marker !== 'string'
      || marker.length === 0
      || typeof validator !== 'object'
      || validator === null
      || Array.isArray(validator)
      || Object.keys(validator).length !== 3
      || validator.kind !== 'result-digest-v1'
      || !/^[0-9a-f]{64}$/u.test(validator.resultDigest)
      || (
        validator.previousResultDigest !== null
        && !/^[0-9a-f]{64}$/u.test(validator.previousResultDigest)
      )
      || !Number.isFinite(submittedAtMs)
    ) {
      fail('KIMI_D9_TURN_OBSERVATION_INVALID');
    }
    this.#marker = marker;
    this.#validator = Object.freeze({ ...validator });
    this.#submittedAtMs = submittedAtMs;
  }

  observe(event) {
    if (!Number.isFinite(event?.observedAtMs)) return;
    if (
      event.type === 'output'
      && typeof event.text === 'string'
    ) {
      if (
        this.#ttfvMs === null
        && event.text.includes(this.#marker)
      ) {
        this.#ttfvMs = Math.max(
          0,
          event.observedAtMs - this.#submittedAtMs,
        );
      }
      this.#resultBuffer = `${this.#resultBuffer}${event.text}`.slice(-16_384);
      for (const match of this.#resultBuffer.matchAll(
        /D9_RESULT_B64:([A-Za-z0-9_-]+)/gu,
      )) {
        try {
          const bytes = Buffer.from(match[1], 'base64url');
          if (bytes.length === 0 || bytes.length > 4_096) continue;
          const payload = JSON.parse(bytes.toString('utf8'));
          if (
            typeof payload !== 'object'
            || payload === null
            || Array.isArray(payload)
            || Object.keys(payload).sort().join(',')
              !== 'previousResult,result'
            || typeof payload.result !== 'string'
            || (
              payload.previousResult !== null
              && typeof payload.previousResult !== 'string'
            )
          ) {
            continue;
          }
          this.#semanticPassed = sha256JsonString(payload.result)
            === this.#validator.resultDigest;
          this.#continuityPassed =
            this.#validator.previousResultDigest === null
              ? payload.previousResult === null
              : (
                typeof payload.previousResult === 'string'
                && sha256JsonString(payload.previousResult)
                  === this.#validator.previousResultDigest
              );
        } catch {
          // A malformed product frame is a failed validator, not harness data.
        }
      }
    }
    if (event.type === 'input_read_attach') {
      this.#readyAfterSubmitAtMs = event.observedAtMs;
    }
    if (event.type === 'turn_completed' || event.type === 'turn_failed') {
      this.#terminalAtMs = event.observedAtMs;
      this.#terminalStatus = event.type === 'turn_completed'
        ? 'completed'
        : 'failed';
    }
  }

  snapshot() {
    const terminal = this.#terminalAtMs !== null
      && this.#readyAfterSubmitAtMs !== null;
    return Object.freeze({
      ttfvMs: this.#ttfvMs,
      totalLatencyMs: terminal
        ? Math.max(0, this.#readyAfterSubmitAtMs - this.#submittedAtMs)
        : null,
      terminal,
      terminalStatus: this.#terminalStatus,
      semanticPassed: this.#semanticPassed,
      continuityPassed: this.#continuityPassed,
    });
  }
}

export function withExternalTimeout(work, { timeoutMs, terminate }) {
  if (
    !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || typeof terminate !== 'function'
  ) {
    fail('KIMI_D9_TIMEOUT_CONTRACT_INVALID');
  }
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try {
        Promise.resolve(terminate()).catch(() => {});
      } catch {
        // Timeout remains authoritative even when best-effort termination fails.
      }
      reject(new Error('KIMI_D9_PRODUCT_TIMEOUT'));
    }, timeoutMs);
  });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

export async function waitForCondition(
  predicate,
  {
    timeoutMs,
    intervalMs = 20,
    timeoutCode = 'KIMI_D9_PRODUCT_TIMEOUT',
  },
) {
  if (
    typeof predicate !== 'function'
    || !Number.isFinite(timeoutMs)
    || timeoutMs <= 0
    || !Number.isFinite(intervalMs)
    || intervalMs <= 0
  ) {
    fail('KIMI_D9_WAIT_CONTRACT_INVALID');
  }
  const startedAt = performance.now();
  while (performance.now() - startedAt < timeoutMs) {
    const result = await predicate();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  fail(timeoutCode);
}

export class TmuxPtySession {
  #tmuxExecutable;
  #sessionName;
  #columns;
  #rows;
  #started = false;

  constructor({
    tmuxExecutable,
    sessionName,
    columns = 120,
    rows = 40,
  }) {
    if (
      typeof tmuxExecutable !== 'string'
      || !isAbsolute(tmuxExecutable)
      || typeof sessionName !== 'string'
      || !/^[a-zA-Z0-9_-]{1,80}$/u.test(sessionName)
      || !Number.isSafeInteger(columns)
      || columns < 40
      || !Number.isSafeInteger(rows)
      || rows < 20
    ) {
      fail('KIMI_D9_TMUX_CONTRACT_INVALID');
    }
    this.#tmuxExecutable = tmuxExecutable;
    this.#sessionName = sessionName;
    this.#columns = columns;
    this.#rows = rows;
  }

  async #run(args, { check = true } = {}) {
    try {
      return await execFileAsync(this.#tmuxExecutable, args, {
        encoding: 'utf8',
        maxBuffer: 1_048_576,
      });
    } catch (error) {
      if (!check) return { stdout: '', stderr: String(error) };
      fail('KIMI_D9_TMUX_COMMAND_FAILED');
    }
  }

  async start({ command, args, cwd, env }) {
    if (
      this.#started
      || typeof command !== 'string'
      || !isAbsolute(command)
      || !isAbsolute(cwd)
      || !Array.isArray(args)
      || args.some(argument => typeof argument !== 'string')
      || typeof env !== 'object'
      || env === null
    ) {
      fail('KIMI_D9_TMUX_CONTRACT_INVALID');
    }
    await this.#run(
      ['kill-session', '-t', this.#sessionName],
      { check: false },
    );
    const environmentArguments = Object.entries(env)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => `${name}=${String(value)}`);
    await this.#run([
      'new-session',
      '-d',
      '-s',
      this.#sessionName,
      '-x',
      String(this.#columns),
      '-y',
      String(this.#rows),
      '-c',
      cwd,
      '--',
      '/usr/bin/env',
      '-i',
      ...environmentArguments,
      command,
      ...args,
    ]);
    await this.#run([
      'set-option',
      '-t',
      this.#sessionName,
      'remain-on-exit',
      'on',
    ]);
    this.#started = true;
    return this.panePid();
  }

  async sendText(text) {
    if (!this.#started || typeof text !== 'string' || text.includes('\0')) {
      fail('KIMI_D9_TMUX_INPUT_INVALID');
    }
    const characters = [...text];
    for (let index = 0; index < characters.length; index += 256) {
      await this.#run([
        'send-keys',
        '-l',
        '-t',
        this.#sessionName,
        '--',
        characters.slice(index, index + 256).join(''),
      ]);
    }
  }

  async pressEnter() {
    if (!this.#started) {
      fail('KIMI_D9_TMUX_INPUT_INVALID');
    }
    await this.#run([
      'send-keys',
      '-t',
      this.#sessionName,
      'Enter',
    ]);
  }

  async sendLine(text) {
    await this.sendText(text);
    await this.pressEnter();
  }

  async panePid() {
    const { stdout } = await this.#run([
      'display-message',
      '-p',
      '-t',
      this.#sessionName,
      '#{pane_pid}',
    ]);
    const value = Number.parseInt(stdout.trim(), 10);
    if (!Number.isSafeInteger(value) || value <= 0) {
      fail('KIMI_D9_TMUX_PID_INVALID');
    }
    return value;
  }

  async isDead() {
    const { stdout } = await this.#run([
      'display-message',
      '-p',
      '-t',
      this.#sessionName,
      '#{pane_dead}',
    ]);
    return stdout.trim() === '1';
  }

  async capture() {
    const { stdout } = await this.#run([
      'capture-pane',
      '-p',
      '-J',
      '-t',
      this.#sessionName,
    ]);
    return stdout;
  }

  async stop() {
    if (!this.#started) return;
    await this.#run(
      ['kill-session', '-t', this.#sessionName],
      { check: false },
    );
    this.#started = false;
  }
}
