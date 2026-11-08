import {afterEach, expect, it, vi} from 'vitest';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createVerificationCompletionComposition} from '../../../src/runtime/verification/completion-composition.js';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createProfileIndexPublisher} from '../../../src/runtime/verification/profile-index-publication.js';
import {createMigrationMarkerJournal} from '../../../src/runtime/verification/migration-marker-journal.js';
import {migrationProfileDirectoryName} from '../../../src/runtime/verification/migration-markers.js';
import {createReceiverReplyVerifier} from '../../../src/runtime/verification/receiver-authentication.js';
import {canonicalVerificationJson as json} from '../../../src/runtime/verification/protocol.js';
import * as atomic from '../../../src/utils/atomic-file.js';

const H = 'a'.repeat(64), peer = {uid: 501, gid: 20, auditSessionId: 7};
const digest = (value: unknown) => createHash('sha256').update(json(value)).digest('hex');
const disposals: Array<() => Promise<void>> = [];
afterEach(async () => {
  const failures: unknown[] = [];
  for (const dispose of disposals.splice(0).reverse()) {
    try { await dispose(); } catch (error) { failures.push(error); }
  }
  vi.restoreAllMocks();
  if (failures.length) throw new AggregateError(failures, 'main_root_fixture_cleanup');
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'main-root-enrollment-'));
  const markers = join(root, 'markers');
  mkdirSync(markers, {mode: 0o755});
  const database = openPrivateVerificationDatabase(join(root, 'db'));
  const keys = generateKeyPairSync('ed25519');
  let now = 1000, clockBroken = false, approvals = 0;
  let currentHook: (()=>void)|undefined, principalHook: (()=>void)|undefined, retainUnknown=false;
  let approvalHook: ((review: any, signal: AbortSignal) => Promise<void>) | undefined;
  const reviews: any[] = [];
  const clock = () => {
    if (clockBroken) throw Error('fixture clock unavailable');
    return {domainId: 'clock', qualificationEpoch: 1, lowerBound: now, upperBound: now + 1, evidenceHash: H};
  };
  // Actual SQLite/filesystem/composition entry. Native approval is an explicit
  // external SDK seam, never an installed/Main qualification or a resource grant.
  let publication = createMigrationMarkerJournal({
    root: markers, database, authorityId: 'authority', assertCurrent() {}, assertAuthorized() { throw Error('not an owner marker grant'); },
  });
  function buildComposition(){return createVerificationCompletionComposition({
    root, database, authorityId: 'authority',
    authority: {
      receiverVerifier: createReceiverReplyVerifier({keyId: 'receiver', receiverId: 'receiver', receiverInstanceEpoch: 1, publicKey: keys.publicKey}),
      issuerId: 'authority', verifierHash: H, keyId: 'key', serviceEpoch: 'boot', privateKey: keys.privateKey,
      clock, assertQualified() {}, quiescence: {assertQuiescent() {}},
    },
    enrollment: {
      resolvePrincipal: (p: typeof peer) => {principalHook?.();return {...p, accountGeneration: '11111111-AAAA-BBBB-CCCC-555555555555', source: 'macos-local-generateduid' as const};},
      approve: async () => { throw Error('old owner approval cannot authorize a MainRoot request'); },
      profilePublication: createProfileIndexPublisher({root: markers, database, authorityId: 'authority', assertCurrent() {}}),
      mainRootFamily: {
        publication, assertCurrent() {currentHook?.();},
        async approve(review: any, signal: AbortSignal) {
          approvals++; reviews.push(review); await approvalHook?.(review, signal);
          return {uid: peer.uid, auditSessionId: peer.auditSessionId, reviewHash: digest(review)};
        },
      },
    } as any,
    recipePorts: {
      assertCurrent() {}, assertFailedRunComplete() { throw Error('unused'); },
      async readArtifact() { throw Error('unused'); }, async runBlackbox() { throw Error('unused'); }, async readFailedRun() { throw Error('unused'); },
    },
  });
  }
  let composition=buildComposition();
  const invoke = async (method: string, payload: unknown, actor = peer) =>
    await composition.public.invoke(method as never, payload, actor, new AbortController().signal) as any;
  disposals.push(async () => {
    if(retainUnknown){expect(database.open).toBe(true);expect(existsSync(root)).toBe(true);return;}
    await composition.close();
    database.close();
    rmSync(root, {recursive: true, force: true});
  });
  return {
    root, markers, database, get composition(){return composition;}, invoke, reviews, approvals: () => approvals,
    async restart(){await composition.close();publication=createMigrationMarkerJournal({root:markers,database,authorityId:'authority',assertCurrent(){},assertAuthorized(){throw Error('not owner approval');}});composition=buildComposition();},
    breakClock() { clockBroken = true; }, advance() { now += 300001; },
    retainUnknownRoot(){retainUnknown=true;}, currentHook(fn:()=>void){currentHook=fn;}, principalHook(fn:()=>void){principalHook=fn;},
    hook(fn: typeof approvalHook) { approvalHook = fn; },
    prepare: (requestId = 'request-1') => invoke('completion.prepare-main-root-family', {requestId, requestSource: 'user'}),
  };
}

it('prepares one real journal/profile intent without a business owner, resource pool or user write fence', async () => {
  const f = fixture(), prepared = await f.prepare();
  expect(prepared).toMatchObject({phase: 'pending', consent: 'required', pendingOnly: true, activation: 'unavailable'});
  expect(prepared.operationId).toBeTypeOf('string');
  expect(f.database.prepare('SELECT count(*) n FROM migration_publication_intents').get()).toEqual({n: 1});
  expect(f.database.prepare('SELECT count(*) n FROM verification_profiles').get()).toEqual({n: 1});
  expect(f.database.prepare('SELECT count(*) n FROM verification_registered_owners').get()).toEqual({n: 0});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_challenges').get()).toEqual({n: 0});
  expect(f.database.prepare('SELECT count(*) n FROM owner_enrollment_requests').get()).toEqual({n: 0});
  expect(existsSync(join(f.markers, 'principals', String(peer.uid) + '.json'))).toBe(false);
  expect(f.approvals()).toBe(0);
});

it.each(['agent', 'scheduler', undefined])('denies %s mutation before Native approval or profile/journal allocation', async requestSource => {
  const f = fixture();
  await expect(f.invoke('completion.prepare-main-root-family', {requestId: 'request-1', ...(requestSource === undefined ? {} : {requestSource})})).rejects.toThrow('main_root_enrollment_source');
  expect(f.database.prepare('SELECT count(*) n FROM verification_profiles').get()).toEqual({n: 0});
  expect(f.approvals()).toBe(0);
});

it('pins the pending-only Native body and publishes a real denial-only record without claiming accepted', async () => {
  const f = fixture(), prepared = await f.prepare();
  const result = await f.invoke('completion.authorize-main-root-family', {operationId: prepared.operationId, requestSource: 'user'});
  expect(result).toMatchObject({operationId: prepared.operationId, phase: 'pending', consent: 'authorized', pendingOnly: true, activation: 'unavailable'});
  expect(f.approvals()).toBe(1);
  expect(f.reviews[0]).toMatchObject({purpose: 'main-root-family-enrollment', authorizationScope: 'pending-only', operationId: prepared.operationId});
  expect(f.reviews[0].targets.map((row: any) => row.family)).toEqual(['admission', 'budget', 'kswarm', 'broker']);
  expect(f.reviews[0]).not.toHaveProperty('namespaceId');
  const row = f.database.prepare('SELECT marker_json,published,state FROM migration_publication_intents').get() as any;
  expect(row).toMatchObject({state: 'pending', published: 1});
  const record = JSON.parse(row.marker_json);
  expect(record).toMatchObject({purpose: 'main-root-family-enrollment', state: 'pending', phase: 'authorized'});
  expect(record).not.toHaveProperty('accepted');
  expect(existsSync(join(f.markers, 'principals', String(peer.uid) + '.json'))).toBe(false);
  expect(readFileSync(join(f.markers, migrationProfileDirectoryName(result.profileId), 'main-root-family.pending.json'), 'utf8')).toBe(row.marker_json);
});

it('replays the same original request and refuses a replacement intent instead of allocating another namespace', async () => {
  const f = fixture(), one = await f.prepare(), two = await f.prepare();
  expect(two.operationId).toBe(one.operationId);
  await expect(f.prepare('replacement-request')).rejects.toThrow('main_root_enrollment_conflict');
  expect(f.database.prepare('SELECT count(*) n FROM migration_publication_intents').get()).toEqual({n: 1});
});

it('does not expose or mutate another account operation', async () => {
  const f = fixture(), prepared = await f.prepare(), foreign = {...peer, uid: 502};
  await expect(f.invoke('completion.read-main-root-family', {operationId: prepared.operationId}, foreign)).rejects.toThrow('main_root_enrollment_principal');
  await expect(f.invoke('completion.cancel-main-root-family', {operationId: prepared.operationId, requestSource: 'user'}, foreign)).rejects.toThrow('main_root_enrollment_principal');
  expect(f.approvals()).toBe(0);
});

it('can cancel an unapproved pending request without disabling ordinary writers or obtaining a Native grant', async () => {
  const f = fixture(), prepared = await f.prepare();
  const result = await f.invoke('completion.cancel-main-root-family', {operationId: prepared.operationId, requestSource: 'user'});
  expect(result).toMatchObject({phase: 'cancelled', pendingOnly: true, activation: 'unavailable'});
  await expect(f.invoke('completion.authorize-main-root-family', {operationId: prepared.operationId, requestSource: 'user'})).rejects.toThrow('main_root_enrollment_cancelled');
  expect(f.approvals()).toBe(0);
  expect(existsSync(join(f.markers, 'principals', String(peer.uid) + '.json'))).toBe(false);
});

it('keeps read and negative cancellation available when the current clock cannot be sampled', async () => {
  const f = fixture(), prepared = await f.prepare(); f.breakClock();
  expect(await f.invoke('completion.read-main-root-family', {operationId: prepared.operationId})).toMatchObject({consent: 'required'});
  expect(await f.invoke('completion.cancel-main-root-family', {operationId: prepared.operationId, requestSource: 'user'})).toMatchObject({phase: 'cancelled'});
});

it('recovers the same committed pending publication after a real directory barrier failure without replaying approval', async () => {
  const f = fixture(), prepared = await f.prepare();
  const failure = Error('pending projection fsync failed');
  const barrier = vi.spyOn(atomic, 'syncDirectoryTreeStrict').mockImplementation(() => { throw failure; });
  try {
    await expect(f.invoke('completion.authorize-main-root-family', {operationId: prepared.operationId, requestSource: 'user'})).rejects.toBe(failure);
  } finally { barrier.mockRestore(); }
  expect(f.database.prepare('SELECT state,published FROM migration_publication_intents').get()).toEqual({state: 'pending', published: 0});
  const result = await f.invoke('completion.recover-main-root-family', {operationId: prepared.operationId, requestSource: 'user'});
  expect(result).toMatchObject({operationId: prepared.operationId, consent: 'authorized', activation: 'unavailable'});
  expect(f.approvals()).toBe(1);
});

it('refuses a caller-selected scope, claimed known state or fake business-owner variant', async () => {
  const f = fixture();
  for (const extra of [{scopeDigest: H}, {known: true}, {ownerKind: 'MainRoot'}, {accepted: true}]) {
    await expect(f.invoke('completion.prepare-main-root-family', {requestId: 'request-1', requestSource: 'user', ...extra})).rejects.toThrow('main_root_enrollment_request');
  }
  expect(f.approvals()).toBe(0);
  expect(f.database.prepare('SELECT count(*) n FROM verification_profiles').get()).toEqual({n: 0});
});


it('retains original own-symbol SDK tails and joins them before acknowledging close', async () => {
  const f=fixture(), prepared=await f.prepare();let release!:()=>void;
  const held=new Promise<void>(yes=>{release=yes;}), failure=Error('original Native failure');
  Object.defineProperty(failure,Symbol('held'),{value:held});
  f.hook(async()=>{throw failure;});
  await expect(f.invoke('completion.authorize-main-root-family',{operationId:prepared.operationId,requestSource:'user'})).rejects.toBe(failure);
  let closed=false;const originalClose=f.composition.close()!;const close=originalClose.then(()=>{closed=true;});
  expect(f.composition.close()).toBe(originalClose);
  await Promise.resolve();await Promise.resolve();expect(closed).toBe(false);expect(f.database.open).toBe(true);
  release();await close;expect(closed).toBe(true);
});

it('preserves throw undefined presence from the actual Native SDK seam', async()=>{
  const f=fixture(),prepared=await f.prepare();f.hook(async()=>{throw undefined;});
  let caught=false;
  try{await f.invoke('completion.authorize-main-root-family',{operationId:prepared.operationId,requestSource:'user'});}
  catch(error){caught=true;expect(error).toBeUndefined();}
  expect(caught).toBe(true);
  expect(await f.invoke('completion.read-main-root-family',{operationId:prepared.operationId})).toMatchObject({consent:'failed'});
});

it('keeps a known SDK tail even when an unknown accessor exists, and retains the real database on close unknown',async()=>{
  const f=fixture(),prepared=await f.prepare();let release!:()=>void, touched=0;
  const held=new Promise<void>(yes=>{release=yes;}),failure=Error('unknown Native outcome');
  Object.defineProperties(failure,{opaque:{get(){touched++;return 1;}},cause:{value:held}});
  f.hook(async()=>{throw failure;});
  await expect(f.invoke('completion.authorize-main-root-family',{operationId:prepared.operationId,requestSource:'user'})).rejects.toBe(failure);
  f.retainUnknownRoot();let ended=false;
  const close=f.composition.close()!.then(()=>{ended=true;},error=>{ended=true;return error;});
  await Promise.resolve();await Promise.resolve();expect(ended).toBe(false);expect(touched).toBe(0);
  release();expect(await close).toBeInstanceOf(Error);expect(f.database.open).toBe(true);expect(existsSync(f.root)).toBe(true);expect(touched).toBe(0);
});

it('registers the physical call before a current callback can synchronously dispose',async()=>{
  const f=fixture();let close:Promise<void>|undefined, calls=0;
  f.currentHook(()=>{calls++;close=f.composition.close();});
  await expect(f.prepare()).rejects.toThrow('main_root_enrollment_closed');
  await close;expect(calls).toBe(1);
  expect(f.database.prepare('SELECT count(*) n FROM verification_profiles').get()).toEqual({n:0});
});

it('recovers metadata for the same account in a new audit session, without granting old session consent',async()=>{
  const f=fixture(),prepared=await f.prepare(),restored={...peer,auditSessionId:8};
  expect(await f.invoke('completion.read-main-root-family',{operationId:prepared.operationId},restored)).toMatchObject({consent:'required'});
  await expect(f.invoke('completion.authorize-main-root-family',{operationId:prepared.operationId,requestSource:'user'},restored)).rejects.toThrow('main_root_enrollment_deadline');
  expect(await f.invoke('completion.cancel-main-root-family',{operationId:prepared.operationId,requestSource:'user'},restored)).toMatchObject({phase:'cancelled'});
  expect(f.approvals()).toBe(0);
});

it('keeps the cancelled request history when preparing a new request in the same profile',async()=>{
  const f=fixture(),one=await f.prepare();await f.invoke('completion.cancel-main-root-family',{operationId:one.operationId,requestSource:'user'});
  const two=await f.prepare('request-2');expect(two.operationId).not.toBe(one.operationId);expect(two.profileId).toBe(one.profileId);
  await f.invoke('completion.authorize-main-root-family',{operationId:two.operationId,requestSource:'user'});
  await expect(f.invoke('completion.recover-main-root-family',{operationId:one.operationId,requestSource:'user'})).rejects.toThrow('main_root_enrollment_superseded');
  expect(f.database.prepare('SELECT count(*) n FROM migration_publication_intents').get()).toEqual({n:2});
});


it('reads and recovers a previous boot authorizing intent as unknown without replaying Native approval',async()=>{
 const f=fixture(),prepared=await f.prepare();const row=f.database.prepare('SELECT owner_key,marker_json FROM migration_publication_intents').get() as any;
 const record=JSON.parse(row.marker_json);record.phase='authorizing';f.database.prepare('UPDATE migration_publication_intents SET marker_json=? WHERE owner_key=?').run(json(record),row.owner_key);
 await f.restart();expect(await f.invoke('completion.read-main-root-family',{operationId:prepared.operationId})).toMatchObject({consent:'authorizing'});
 expect(await f.invoke('completion.recover-main-root-family',{operationId:prepared.operationId,requestSource:'user'})).toMatchObject({consent:'unknown',activation:'unavailable'});
 await expect(f.invoke('completion.authorize-main-root-family',{operationId:prepared.operationId,requestSource:'user'})).rejects.toThrow('main_root_enrollment_consumed');expect(f.approvals()).toBe(0);
 expect(await f.invoke('completion.cancel-main-root-family',{operationId:prepared.operationId,requestSource:'user'})).toMatchObject({phase:'cancelled'});
});

it('rejects an expired original request before Native approval and keeps metadata readable and cancellable',async()=>{
 const f=fixture(),prepared=await f.prepare();f.advance();await expect(f.invoke('completion.authorize-main-root-family',{operationId:prepared.operationId,requestSource:'user'})).rejects.toThrow('main_root_enrollment_deadline');
 expect(f.approvals()).toBe(0);expect(await f.invoke('completion.read-main-root-family',{operationId:prepared.operationId})).toMatchObject({consent:'required'});
 expect(await f.invoke('completion.cancel-main-root-family',{operationId:prepared.operationId,requestSource:'user'})).toMatchObject({phase:'cancelled'});
});
