import { runWithOriginalRootExecutionContext } from '../../../src/runtime/verification/original-root-execution-context.js';
// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  realpathSync,
  lstatSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runRoomWorkspaceExecutor,
  readOriginalRoomWorkspaceExecutorPhysicalFate,
  type RoomWorkspaceExecutionContext,
  type WorkspaceExecutionPort,
} from '../../electron/room-workspace-executor.js';
const cleanup: Array<() => void> = [];
afterEach(() => {
  for (const close of cleanup.splice(0).reverse()) close();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'room-project-physical-')),
    prior = process.env.XIAOK_CONFIG_DIR;
  const config = join(root, 'config');
  mkdirSync(config, { mode: 0o700 });
  process.env.XIAOK_CONFIG_DIR = config;
  cleanup.push(() => {
    if (prior === undefined) delete process.env.XIAOK_CONFIG_DIR;
    else process.env.XIAOK_CONFIG_DIR = prior;
    rmSync(root, { recursive: true, force: true });
  });
  const cwd = realpathSync(root),
    s = lstatSync(cwd, { bigint: true });
  const context: RoomWorkspaceExecutionContext = {
    roomId: 'r',
    logicalAgentId: 'a',
    runId: 'run',
    claimId: 'claim',
    executorInstanceId: 'executor',
    workspaceId: 'workspace',
    bindingId: 'binding',
    generation: 1,
    instructionsRevision: 0,
    effectiveCwd: cwd,
    publishedInstructions: '',
    contextScope: { kind: 'project', projectId: 'p' },
    workspaceRoot: {
      canonicalRoot: cwd,
      identity: {
        dev: String(s.dev),
        ino: String(s.ino),
        birthtimeNs: String(s.birthtimeNs),
      },
    },
  };
  let releases = 0;
  const port: WorkspaceExecutionPort = {
    async authorize() {},
    async acquireChild() {
      throw Error('fixture no child');
    },
    async release() {
      releases++;
    },
    async submitManifest() {},
  };
  return {
    root,
    context,
    port,
    get releases() {
      return releases;
    },
  };
}
it('keeps original runner own-child SDK raw held before reporting physical workspace release', async () => {
  const f = fixture();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((yes) => {
      release = yes;
    }),
    ready = new Promise<void>((yes) => {
      entered = yes;
    });
  let settled = false;
  const running = runRoomWorkspaceExecutor({
    context: f.context,
    port: f.port,
    prompt: 'Original executor physical raw',
    createRunner: () => () => {
      const raw = Promise.resolve();
      Object.defineProperty(raw, 'actualHeldChild', { value: held });
      entered();
      return raw;
    },
  });
  void running.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await ready;
  try {
    await new Promise((yes) => setTimeout(yes, 25));
    expect(settled).toBe(false);
    expect(f.releases).toBe(0);
  } finally {
    release();
    await running;
  }
  expect(f.releases).toBe(1);
});
it('preserves an undefined original body cause while joining the actual rejected release child tail', async () => {
  const f = fixture();
  let release!: () => void, releaseEntered!: () => void;
  const tail = new Promise<void>((yes) => {
      release = yes;
    }),
    ready = new Promise<void>((yes) => {
      releaseEntered = yes;
    });
  const cleanupError = Object.assign(
    Error('original_workspace_release_failed'),
    { physicalChild: tail },
  );
  f.port.release = () => {
    releaseEntered();
    return Promise.reject(cleanupError);
  };
  let settled = false;
  const running = runRoomWorkspaceExecutor({
    context: f.context,
    port: f.port,
    prompt: 'Original executor failure presence',
    createRunner: () => () => {
      throw undefined;
    },
  });
  const outcome = running.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  void outcome.then(() => {
    settled = true;
  });
  await ready;
  try {
    await new Promise((yes) => setTimeout(yes, 20));
    expect(settled).toBe(false);
  } finally {
    release();
  }
  const result = await outcome;
  expect('error' in result).toBe(true);
  if (!('error' in result)) throw Error('original failure missing');
  expect(result.error).toBeInstanceOf(AggregateError);
  expect(result.error.errors[0]).toBeUndefined();
  expect(result.error.errors).toContain(cleanupError);
});

it('joins known raw before reporting sticky unknown, and passive fate never treats a copied proof as a member', async () => {
  const f = fixture(),
    proof = Object.freeze(Object.create(null)),
    parent = Object.freeze(Object.create(null));
  let release!: () => void,
    entered!: () => void,
    getters = 0;
  const held = new Promise<void>((yes) => {
      release = yes;
    }),
    ready = new Promise<void>((yes) => {
      entered = yes;
    });
  const running = runWithOriginalRootExecutionContext(parent, () =>
    runRoomWorkspaceExecutor({
      context: f.context,
      port: f.port,
      originalRootCandidate: proof,
      prompt: 'Original inventory unknown',
      createRunner: () => () => {
        const raw = Promise.resolve();
        Object.defineProperty(raw, 'unconfirmed', {
          get() {
            getters++;
            return 'bad';
          },
        });
        Object.defineProperty(raw, 'physicalChild', { value: held });
        entered();
        return raw;
      },
    }),
  );
  let settled = false;
  const outcome = running.then(
    (value) => ({ value }),
    (error) => ({ error }),
  );
  void outcome.then(() => {
    settled = true;
  });
  await ready;
  try {
    await new Promise((yes) => setTimeout(yes, 20));
    expect(settled).toBe(false);
    expect(f.releases).toBe(0);
    expect(getters).toBe(0);
  } finally {
    release();
  }
  expect('error' in (await outcome)).toBe(true);
  const fate = readOriginalRoomWorkspaceExecutorPhysicalFate(proof, parent);
  await expect(fate.waitKnown()).rejects.toThrow();
  expect(() => fate.assertKnown()).toThrow();
  expect(getters).toBe(0);
  const foreign = new Proxy(
    {},
    {
      get() {
        getters++;
        throw Error('getter');
      },
    },
  );
  expect(() =>
    readOriginalRoomWorkspaceExecutorPhysicalFate(foreign, parent),
  ).toThrow('ORIGINAL_EXECUTOR_FATE_REQUIRED');
  expect(getters).toBe(0);
});
