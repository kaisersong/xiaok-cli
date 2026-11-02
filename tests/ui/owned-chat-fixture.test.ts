import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Command } from 'commander';
import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { once } from 'node:events';
import { OwnedChatFixtures } from '../support/owned-chat-fixture.js';
import { createTtyHarness } from '../support/tty.js';
const roots: string[] = [];
const originalConfigDir = process.env.XIAOK_CONFIG_DIR;
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive:true,force:true}); if(originalConfigDir===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=originalConfigDir; });
function fixture(timeout = 1000) {
 const root=mkdtempSync(join(tmpdir(),'xiaok-owned-fixture-'));roots.push(root);const config=join(root,'config');mkdirSync(config);process.env.XIAOK_CONFIG_DIR=config;
 return {root,manager:new OwnedChatFixtures(()=>[root],{cleanupTimeoutMs:timeout}),harness:createTtyHarness()};
}
describe('owned chat fixture lifecycle', () => {
 it('composes the original cancellation signal and preserves un-aborted options', async () => {
  const {manager,harness}=fixture();const program=new Command();program.action(()=>{});
  try {const pending=manager.start(program,['node','fixture'],harness);const scope=manager.scopeFor(harness);const original=new AbortController();const options=manager.readOptions(scope,{signal:original.signal});expect(options?.signal?.aborted).toBe(false);original.abort();expect(options?.signal?.aborted).toBe(true);await pending;await manager.close(harness);expect(manager.snapshot(harness).closed).toBe(true);}finally{harness.restore();}
 });
 it('supports cleanup cancellation before a read is registered', async () => {
  const {manager,harness}=fixture();let release!:()=>void;const program=new Command();const wait=new Promise<void>(resolve=>{release=resolve;});program.action(()=>wait);
  try {const pending=manager.start(program,['node','fixture'],harness);const scope=manager.scopeFor(harness);const closing=manager.close(harness);expect(manager.readOptions(scope,undefined)?.signal?.aborted).toBe(true);release();await pending;await closing;expect(manager.snapshot(harness).pendingSettled).toBe(true);manager.assertCanRestoreAndDelete();}finally{harness.restore();}
 });
 it('retains the original assertion and poisoned ownership when close times out', async () => {
  const {root,manager,harness}=fixture(20);let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});const program=new Command();program.action(()=>wait);
  try {const pending=manager.start(program,['node','fixture'],harness);const original=new Error('original fixture assertion');manager.noteFailure(harness,original);let failure:unknown;try{await manager.close(harness);}catch(error){failure=error;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors).toContain(original);expect(manager.snapshot(harness).poisoned).toBe(true);expect(()=>manager.assertCanRestoreAndDelete()).toThrow();expect(()=>manager.beforeCase()).toThrow();expect(existsSync(root)).toBe(true);release();await pending;expect(()=>manager.beforeCase()).toThrow();}finally{harness.restore();}
 });
 it('reports a distinct chat rejection alongside the original assertion after cleanup', async () => {
  const {manager,harness}=fixture();let reject!:(error:unknown)=>void;const wait=new Promise<never>((_,fail)=>{reject=fail;});const program=new Command();program.action(()=>wait);
  try {const pending=manager.start(program,['node','fixture'],harness);const original=new Error('original assertion');const rejection=new Error('independent chat rejection');manager.noteFailure(harness,original);reject(rejection);await expect(pending).rejects.toBe(rejection);await manager.close(harness);let failure:unknown;try{manager.assertNoUnobservedErrors();}catch(error){failure=error;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors).toEqual([original,rejection]);manager.assertCanRestoreAndDelete();}finally{harness.restore();}
 });
 it('waits for actual child close after its exit event', async () => {
  const {manager,harness}=fixture();const program=new Command();program.action(()=>{});
  try {await manager.start(program,['node','fixture'],harness);const child=spawn(process.execPath,['-e','process.stdout.write("done")'],{stdio:['ignore','pipe','pipe']});manager.recordChild(manager.scopeFor(harness),child);let liveAtExit=-1;child.once('exit',()=>{liveAtExit=manager.snapshot(harness).liveOwners;});await once(child,'close');expect(liveAtExit).toBe(1);await manager.close(harness);expect(manager.snapshot(harness).closedOwners).toBe(1);}finally{harness.restore();}
 });

 it('rejects lookalike owner scripts, foreign config files and extra arguments', async () => {
  const {root,manager,harness}=fixture();const program=new Command();program.action(()=>{});
  try {await manager.start(program,['node','fixture'],harness);const scope=manager.scopeFor(harness);const expected={entryPath:join(root,'runtime','conversation-activity','owner-entry.js'),configFile:join(scope.configRoot,'activity-owner.config.json')};expect(()=>manager.validateSpawn(scope,[expected.entryPath,expected.configFile],expected)).not.toThrow();expect(()=>manager.validateSpawn(scope,[join(root,'other','runtime','conversation-activity','owner-entry.js'),expected.configFile],expected)).toThrow('fixture_owner_spawn_identity_mismatch');expect(()=>manager.validateSpawn(scope,[expected.entryPath,join(root,'foreign.json')],expected)).toThrow('fixture_owner_spawn_identity_mismatch');expect(()=>manager.validateSpawn(scope,[expected.entryPath,expected.configFile,'extra'],expected)).toThrow('fixture_owner_spawn_identity_mismatch');await manager.close(harness);}finally{harness.restore();}
 });

 it('keeps assertion, chat rejection and child-close timeout together', async () => {
  const {manager,harness}=fixture(20);let reject!:(error:unknown)=>void;const wait=new Promise<never>((_,fail)=>{reject=fail;});const program=new Command();program.action(()=>wait);const child=Object.assign(new EventEmitter(),{kill:()=>true}) as unknown as ChildProcess;
  try {const pending=manager.start(program,['node','fixture'],harness);const scope=manager.scopeFor(harness);manager.recordChild(scope,child);const original=new Error('original assertion');const rejection=new Error('independent chat rejection');manager.noteFailure(harness,original);reject(rejection);await expect(pending).rejects.toBe(rejection);let failure:unknown;try{await manager.close(harness);}catch(error){failure=error;}expect(failure).toBeInstanceOf(AggregateError);expect((failure as AggregateError).errors).toContain(original);expect((failure as AggregateError).errors).toContain(rejection);expect((failure as AggregateError).errors.some((error:Error)=>error.message==='fixture_close_timeout:activity-owner')).toBe(true);expect(manager.snapshot(harness).poisoned).toBe(true);}finally{child.emit('close',0,null);harness.restore();}
 });

});
