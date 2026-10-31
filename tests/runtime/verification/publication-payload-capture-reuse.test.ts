import '../../support/installed-controller-fixture.js';
import { createHash } from 'node:crypto';
import { Session } from 'node:inspector';
import { expect, it } from 'vitest';
import ts from 'typescript';
import { verifiedOperationFixture } from '../../support/verified-operation-fixture.js';
import { createLoopApplicationBinding } from '../../../src/runtime/verification/loop-application-binding.js';

type FunctionCoverage = {
  functionName: string;
  ranges: Array<{ startOffset: number; endOffset: number; count: number }>;
};
type ScriptCoverage = { scriptId: string; url: string; functions: FunctionCoverage[] };
const productionScript = /\/src\/runtime\/verification\/verified-publication-payload\.(?:ts|js)$/;

function post(session: Session, method: string, params: object = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    session.post(method as any, params, (error, result) => error ? reject(error) : resolve(result));
  });
}

/** Inspect the executed script, not a separately imported parser or a mock. */
function bodyDecodeSites(source: string) {
  const ast = ts.createSourceFile('executed-payload.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const sites: Array<{ functionName: string; offset: number; argument: string }> = [];
  const helperCalls: Array<{ functionName: string; argument: string }> = [];
  function enclosingFunction(node: ts.Node): string {
    for (let current = node.parent; current; current = current.parent) {
      if (ts.isFunctionDeclaration(current)) return current.name?.text ?? '<anonymous>';
    }
    return '<module>';
  }
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
      && ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'JSON'
      && node.expression.name.text === 'parse' && node.arguments.length === 1) {
      const argument = node.arguments[0]!;
      if (ts.isCallExpression(argument) && ts.isPropertyAccessExpression(argument.expression)
        && argument.expression.name.text === 'toString') {
        sites.push({ functionName: enclosingFunction(node), offset: node.getStart(ast), argument: argument.getText(ast) });
      }
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)
      && node.expression.text === 'parsePublicationApplicationBody') {
      helperCalls.push({ functionName: enclosingFunction(node), argument: node.arguments[0]?.getText(ast) ?? '' });
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return { sites, helperCalls };
}

function uniqueCoveredFunction(script: ScriptCoverage, name: string): FunctionCoverage {
  const matches = script.functions.filter(fn => fn.functionName === name);
  expect(matches, `exactly one ${name} in the executed production script`).toHaveLength(1);
  expect(matches[0]!.ranges.length, `${name} must have a root range`).toBeGreaterThan(0);
  return matches[0]!;
}

it.sequential('counts one full-body decode per capture across the original five-check sequence', async () => {
  const f = await verifiedOperationFixture();
  try {
    const staged = f.operations.stageVerifiedPayload(f.owner);
    const store = f.composition.privateHost.payloads;
    const session = new Session();
    session.connect();
    let script!: ScriptCoverage;
    let source = '';
    let first!: Buffer;
    let second!: Buffer;
    try {
      await post(session, 'Debugger.enable');
      await post(session, 'Profiler.enable');
      await post(session, 'Profiler.startPreciseCoverage', { callCount: true, detailed: true });

      // Baseline: readRow's decode plus four live rechecks = five actual decodes.
      // Candidate: one decode; every live recheck must still run its real guards.
      const captured = store.capture(staged.payloadId, f.owner);
      first = captured.readBytes();
      captured.assertCurrent();
      second = captured.readBytes();
      captured.assertCurrent();

      const coverage = await post(session, 'Profiler.takePreciseCoverage') as { result: ScriptCoverage[] };
      const matches = coverage.result.filter(item => productionScript.test(item.url.replace(/\\/g, '/')));
      expect(matches, 'unique complete production path, source or emitted').toHaveLength(1);
      script = matches[0]!;
      source = (await post(session, 'Debugger.getScriptSource', { scriptId: script.scriptId })).scriptSource;
    } finally {
      try { await post(session, 'Profiler.stopPreciseCoverage'); }
      finally { session.disconnect(); }
    }

    const decoded = bodyDecodeSites(source);
    // The legacy wrapper may remain in the candidate. Select the function that
    // actually contains JSON.parse(Buffer.toString()), not merely its name.
    const roots = decoded.sites.filter(site => ['assertApplicationPayload', 'parsePublicationApplicationBody'].includes(site.functionName));
    expect(roots, 'one unambiguous full-publication-body root decoder').toHaveLength(1);
    const decoder = uniqueCoveredFunction(script, roots[0]!.functionName);
    const readRow = uniqueCoveredFunction(script, 'readRow');
    const evidence = {
      marker: 'R1046_CAPTURE_ROOT_DECODE',
      script: script.url,
      scriptSHA256: createHash('sha256').update(source).digest('hex'),
      decoder: roots[0]!,
      rootDecodeCount: decoder.ranges[0]!.count,
      fullRowReadCount: readRow.ranges[0]!.count,
      bodyDecodeSites: decoded.sites,
      helperCalls: decoded.helperCalls,
      // The owner retains raw coverage in its existing run log/report.
      rawProductionCoverage: script,
    };
    console.info(JSON.stringify(evidence));
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
    expect(readRow.ranges[0]!.count, 'real full-row read, not a substituted reader').toBe(1);
    expect(decoder.ranges[0]!.count, 'real complete-body parses: baseline 5, candidate 1').toBe(1);

    // After the behavioral count, enforce the review's mandatory line-85 route.
    // decode(body) is the different retention-bundle schema, not this body.
    const publicationSites = decoded.sites.filter(site => site.functionName !== 'decode');
    expect(publicationSites.map(site => site.functionName)).toEqual(['parsePublicationApplicationBody']);
    expect(decoded.helperCalls.some(call => call.functionName === 'retainedEvidence'
      && call.argument.replace(/\s/g, '') === 'payload.payload'), 'retainedEvidence must use the same root decoder').toBe(true);
  } finally {
    await f.close();
  }
}, 120000);

it.sequential('decodes afresh for an independent capture and a new read', async () => {
  const f = await verifiedOperationFixture();
  try {
    const staged = f.operations.stageVerifiedPayload(f.owner), store = f.composition.privateHost.payloads;
    const original = store.capture(staged.payloadId, f.owner).readBytes();
    const session = new Session();
    session.connect();
    let script!: ScriptCoverage;
    let source = '';
    let captured!: ReturnType<typeof store.capture>;
    let read!: Buffer;
    try {
      await post(session, 'Debugger.enable');
      await post(session, 'Profiler.enable');
      await post(session, 'Profiler.startPreciseCoverage', { callCount: true, detailed: true });
      captured = store.capture(staged.payloadId, f.owner);
      read = store.read(staged.payloadId, f.owner);
      const coverage = await post(session, 'Profiler.takePreciseCoverage') as { result: ScriptCoverage[] };
      const matches = coverage.result.filter(item => productionScript.test(item.url.replace(/\\/g, '/')));
      expect(matches).toHaveLength(1);
      script = matches[0]!;
      source = (await post(session, 'Debugger.getScriptSource', { scriptId: script.scriptId })).scriptSource;
    } finally {
      try { await post(session, 'Profiler.stopPreciseCoverage'); }
      finally { session.disconnect(); }
    }
    const roots = bodyDecodeSites(source).sites.filter(site => ['assertApplicationPayload', 'parsePublicationApplicationBody'].includes(site.functionName));
    expect(roots).toHaveLength(1);
    const decoder = uniqueCoveredFunction(script, roots[0]!.functionName);
    const readRow = uniqueCoveredFunction(script, 'readRow');
    console.info(JSON.stringify({ marker: 'R1046_INDEPENDENT_CAPTURE_READ', script: script.url,
      rootDecodeCount: decoder.ranges[0]!.count, fullRowReadCount: readRow.ranges[0]!.count,
      rawProductionCoverage: script }));
    expect(readRow.ranges[0]!.count).toBe(2);
    expect(decoder.ranges[0]!.count).toBe(2);
    expect(read).toEqual(original);
    expect(captured.readBytes()).toEqual(original);
  } finally { await f.close(); }
}, 120000);

it.sequential('keeps detached capture bytes while new reads and captures reject same-length corruption', async () => {
  const f = await verifiedOperationFixture();
  try {
    const staged = f.operations.stageVerifiedPayload(f.owner), store = f.composition.privateHost.payloads;
    const captured = store.capture(staged.payloadId, f.owner), original = captured.readBytes();
    expect(Object.keys(captured).sort()).toEqual(['assertCurrent', 'readBytes']);
    const returned = captured.readBytes();
    returned.fill(0);
    expect(captured.readBytes()).toEqual(original);
    f.database.prepare('UPDATE verified_publication_payloads SET payload=? WHERE payload_id=?')
      .run(Buffer.alloc(original.length, 120), staged.payloadId);
    expect(() => captured.assertCurrent()).not.toThrow();
    expect(captured.readBytes()).toEqual(original);
    expect(() => store.read(staged.payloadId, f.owner)).toThrow('publication_payload_corrupt');
    expect(() => store.capture(staged.payloadId, f.owner)).toThrow('publication_payload_corrupt');
  } finally { await f.close(); }
}, 120000);

it.sequential.each(['payload_hash', 'dependencies_json', 'length', 'deleted'] as const)(
  'rechecks live row metadata after a valid capture: %s', async mutation => {
    const f = await verifiedOperationFixture();
    try {
      const staged = f.operations.stageVerifiedPayload(f.owner), store = f.composition.privateHost.payloads;
      const captured = store.capture(staged.payloadId, f.owner);
      expect(() => captured.assertCurrent()).not.toThrow();
      if (mutation === 'payload_hash') f.database.prepare('UPDATE verified_publication_payloads SET payload_hash=? WHERE payload_id=?').run('f'.repeat(64), staged.payloadId);
      else if (mutation === 'dependencies_json') f.database.prepare('UPDATE verified_publication_payloads SET dependencies_json=? WHERE payload_id=?').run('[]', staged.payloadId);
      else if (mutation === 'length') f.database.prepare('UPDATE verified_publication_payloads SET payload=? WHERE payload_id=?').run(Buffer.from('shorter'), staged.payloadId);
      else f.database.prepare('DELETE FROM verified_publication_payloads WHERE payload_id=?').run(staged.payloadId);
      expect(() => captured.assertCurrent()).toThrow('publication_payload_changed');
      expect(() => captured.readBytes()).toThrow('publication_payload_changed');
    } finally { await f.close(); }
  }, 120000);

it.sequential('keeps the private Buffer copy out of later mutable Buffer.from hooks', async () => {
  const f = await verifiedOperationFixture();
  try {
    const staged = f.operations.stageVerifiedPayload(f.owner), store = f.composition.privateHost.payloads;
    const captured = store.capture(staged.payloadId, f.owner), original = captured.readBytes();
    const nativeFrom = Buffer.from;
    let offeredPrivateBuffer = false;
    let returned!: Buffer;
    try {
      // An observation-only hostile copy hook: never replace a validation guard.
      Buffer.from = function (...args: any[]) {
        if (Buffer.isBuffer(args[0])) offeredPrivateBuffer = true;
        return Reflect.apply(nativeFrom, Buffer, args);
      } as typeof Buffer.from;
      returned = captured.readBytes();
    } finally { Buffer.from = nativeFrom; }
    expect(offeredPrivateBuffer).toBe(false);
    returned.fill(0);
    expect(captured.readBytes()).toEqual(original);
  } finally { await f.close(); }
}, 120000);

it.sequential.each(['pending', 'replacement'] as const)(
  'does not reuse a successful Loop application check after a live %s', async mutation => {
    const f = await verifiedOperationFixture('loop-application');
    try {
      const staged = f.operations.stageVerifiedPayload(f.owner), captured = f.composition.privateHost.payloads.capture(staged.payloadId, f.owner);
      captured.assertCurrent();
      captured.readBytes();
      captured.assertCurrent();
      const host = f.composition.privateHost.authorityHost, active = host.inspectApplication(f.owner).current;
      if (!active || active.binding.kind !== 'loop') throw Error('capture_test_actual_loop_application_required');
      const { triggerHash: _trigger, contractHash: _contract, candidatePayloadHash: _payload, ...base } = active.binding;
      const replacement = createLoopApplicationBinding({ ...base, candidateId: 'capture-reuse-next',
        candidateRevision: base.candidateRevision + 1, body: { ...base.body, summary: 'live replacement' } });
      host.beginApplicationTransition({ owner: f.owner, transitionId: 'capture-reuse-transition',
        previousBindingHash: active.bindingHash, binding: replacement, registrationHash: 'a'.repeat(64) });
      if (mutation === 'replacement') host.finishApplicationTransition(f.owner, 'capture-reuse-transition', () => {});
      expect(() => captured.assertCurrent()).toThrow();
      expect(() => captured.readBytes()).toThrow();
    } finally { await f.close(); }
  }, 120000);

it.sequential('retains fallback publication-body hash and canonical checks after retention has migrated', async () => {
  const f = await verifiedOperationFixture();
  try {
    const staged = f.operations.stageVerifiedPayload(f.owner);
    const again = f.operations.stageVerifiedPayload(f.owner);
    expect(again.immutablePayloadHash).toBe(staged.immutablePayloadHash);
    const row = f.database.prepare('SELECT payload FROM verified_publication_payloads WHERE payload_id=?').get(staged.payloadId) as { payload: Buffer };
    // Hash-correct but non-canonical publication JSON must still fail at the
    // retainedEvidence fallback before section selection or bundle decoding.
    const nonCanonical = Buffer.concat([Buffer.from(' '), row.payload]);
    f.database.prepare('UPDATE verified_publication_payloads SET payload=?,payload_hash=? WHERE payload_id=?')
      .run(nonCanonical, createHash('sha256').update(nonCanonical).digest('hex'), staged.payloadId);
    expect(() => f.operations.stageVerifiedPayload(f.owner)).toThrow('publication_payload_corrupt');
  } finally { await f.close(); }
}, 120000);
