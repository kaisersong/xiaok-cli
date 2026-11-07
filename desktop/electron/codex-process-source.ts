import { createHash, randomUUID } from 'node:crypto';
import type { OriginalProcessSourceRequest } from '../../src/runtime/verification/original-process-source-types.js';
import { readOriginalCodexProcessSession } from './codex-native-service.js';
import { readOriginalCodexProcessLaunch } from './codex-native-transport.js';

const WeakMapCtor = WeakMap, get = WeakMap.prototype.get, set = WeakMap.prototype.set;
const apply = Reflect.apply, freeze = Object.freeze, create = Object.create;
const stringify = JSON.stringify;
export type OriginalCodexProcessSourceRequest = Extract<OriginalProcessSourceRequest, {operation:'spawn'}> & {readonly sourceKind:'codex_transport';readonly domain:'component_only'};
const tickets = new WeakMapCtor<object, Readonly<OriginalCodexProcessSourceRequest>>();
const probes = new WeakMapCtor<object, object>();

/** The public probe, actor strings and launch data alone cannot mint a request.
 * Both fixed readers must find the original Service/session/probe relationship. */
export function createOriginalCodexProcessSourceTicket(probe: object): object {
  const prior = apply(get, probes, [probe]) as object | undefined;
  if (prior) return prior;
  const session = readOriginalCodexProcessSession(probe);
  const launch = readOriginalCodexProcessLaunch(probe);
  session.assertCurrent(); launch.assertCurrent();
  const invocationId = 'codex-process:' + randomUUID();
  // Actual frozen launch bytes stay private; no environment or secret is in DTOs.
  const specHash = createHash('sha256').update('["original-codex-process-v1",' + stringify({
    command: launch.command, argv: launch.argv, options: launch.options,
  }) + ']').digest('hex');
  let failed = false;
  const assertLocal = () => {
    if (failed) throw Error('CODEX_PROCESS_SOURCE_RETIRED');
    try { session.assertLocal(); launch.assertLocal(); }
    catch (error) { failed = true; throw error; }
  };
  const assertCurrent = () => {
    assertLocal();
    try { session.assertCurrent(); launch.assertCurrent(); }
    catch (error) { failed = true; throw error; }
    assertLocal();
  };
  const request = freeze({ __proto__: null, kind: 'original_process_source_request_v1' as const,
    sourceKind: 'codex_transport' as const, context: session.context, invocationId, specHash,
    operation: 'spawn' as const, command: launch.command, argv: launch.argv, options: launch.options,
    domain: 'component_only' as const, assertCurrent, assertLocal });
  const ticket = freeze(create(null)) as object;
  apply(set, tickets, [ticket, request]); apply(set, probes, [probe, ticket]);
  return ticket;
}

/** Membership is checked before any caller properties. Genuine stale tickets
 * keep their guards and never become an absent/legacy request. */
export function readOptionalOriginalCodexProcessSourceRequest(ticket: unknown): Readonly<OriginalCodexProcessSourceRequest> | undefined {
  const row=apply(get, tickets, [ticket]) as Readonly<OriginalCodexProcessSourceRequest> | undefined;
  if(row)row.assertLocal();return row;
}
