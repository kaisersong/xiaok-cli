import { describe, it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ExecutionJournal } from '../../../src/runtime/isolated-execution/execution-journal.js';
const proposal = { sessionIdentity: 's', compoundOperationId: 'op', validationInvocationId: 'v', scopeDigest: 'a'.repeat(64), commandDigest: 'b'.repeat(64), materializationDigest: 'c'.repeat(64), engineBindingId: 'engine', engineEpoch: 1, imageId: 'sha256:' + 'd'.repeat(64) };
describe('private durable execution dispatch journal', () => {
  it('reserves a host identity before one-time dispatch and retains unknown across restart', () => {
    const root = mkdtempSync(join(tmpdir(), 'execution-journal-'));
    let journal = new ExecutionJournal(root);
    try {
      const record = journal.reserve(proposal);
      expect(record.expected.executionIdentity).toMatch(/^[a-f0-9-]{36}$/);
      journal.beginDispatch(record.expected);
      expect(() => journal.beginDispatch(record.expected)).toThrow('execution_dispatch_already_consumed');
      journal.close(); journal = new ExecutionJournal(root);
      journal.recoverInterrupted();
      expect(journal.read(record.expected).state).toBe('unknown');
      expect(() => journal.reserve({ ...proposal, validationInvocationId: 'v2' })).toThrow('execution_active');
      expect(() => journal.beginDispatch(record.expected)).toThrow('execution_dispatch_already_consumed');
      expect(() => journal.read({ ...record.expected, scopeDigest: 'e'.repeat(64) })).toThrow('execution_identity_mismatch');
    } finally { journal.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('cannot replace a recorded container or reorder create/start; a second connection sees the same latch', () => {
    const root = mkdtempSync(join(tmpdir(), 'execution-journal-'));
    const journal = new ExecutionJournal(root), other = new ExecutionJournal(root);
    try {
      const record = journal.reserve(proposal);
      expect(() => journal.markStartRequested(record.expected)).toThrow('execution_state');
      journal.beginDispatch(record.expected);
      journal.bindContainer(record.expected, 'f'.repeat(64));
      expect(() => other.bindContainer(record.expected, 'e'.repeat(64))).toThrow('execution_state');
      journal.markStartRequested(record.expected);
      expect(other.read(record.expected).state).toBe('starting');
      expect(other.read(record.expected).containerId).toBe('f'.repeat(64));
    } finally { other.close(); journal.close(); rmSync(root, { recursive: true, force: true }); }
  });  it('recovers an undelivered reservation by business identity and cancels only a never-dispatched row', () => {
    const root = mkdtempSync(join(tmpdir(), 'execution-journal-'));
    let journal = new ExecutionJournal(root);
    try {
      const first = journal.reserve(proposal); journal.close(); journal = new ExecutionJournal(root); journal.recoverInterrupted();
      const recovered = journal.reserve(proposal);
      expect(recovered.expected.executionIdentity).toBe(first.expected.executionIdentity);
      expect(journal.findActive('s', 'op')?.expected).toEqual(first.expected);
      journal.cancelPrepared(first.expected);
      expect(journal.reserve(proposal).state).toBe('terminal');
      const next = journal.reserve({ ...proposal, validationInvocationId: 'v2' });
      journal.beginDispatch(next.expected);
      expect(() => journal.cancelPrepared(next.expected)).toThrow('execution_state');
    } finally { journal.close(); rmSync(root, { recursive: true, force: true }); }
  });
  it('can bind a found exact container after crash without authorizing another start', () => {
    const root = mkdtempSync(join(tmpdir(), 'execution-journal-'));
    let journal = new ExecutionJournal(root);
    try {
      const first = journal.reserve(proposal); journal.beginDispatch(first.expected);
      journal.close(); journal = new ExecutionJournal(root); journal.recoverInterrupted();
      expect(() => journal.reconcileContainer(first.expected, { containerId: 'f'.repeat(64), engineBindingId: 'other', engineEpoch: 1 })).toThrow('execution_engine_mismatch');
      journal.reconcileContainer(first.expected, { containerId: 'f'.repeat(64), engineBindingId: 'engine', engineEpoch: 1 });
      expect(() => journal.markStartRequested(first.expected)).toThrow('execution_state');
      journal.recordPhysicalTerminal(first.expected, 'f'.repeat(64), 137);
      expect(journal.read(first.expected).state).toBe('terminal');
    } finally { journal.close(); rmSync(root, { recursive: true, force: true }); }
  });

});

import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
it('borrows the exact authority connection and rolls execution intent back with its surrounding transaction',()=>{
 const root=mkdtempSync(join(tmpdir(),'execution-borrow-')),db=openPrivateVerificationDatabase(root);let journal:ExecutionJournal|undefined;
 try{journal=new ExecutionJournal({database:db});expect(()=>db.transaction(()=>{journal!.reserve(proposal);throw Error('allocation failure');})()).toThrow('allocation failure');expect(journal.findActive('s','op')).toBeUndefined();journal.close();expect(db.prepare('SELECT 1 n').get()).toEqual({n:1});}
 finally{journal?.close();db.close();rmSync(root,{recursive:true,force:true});}
});
it('keeps a created cancellation active across restart and cannot restart or pretend an exit code',()=>{
 const root=mkdtempSync(join(tmpdir(),'created-cancel-'));let journal=new ExecutionJournal(root);const id='f'.repeat(64);
 try{const record=journal.reserve(proposal);journal.beginDispatch(record.expected);journal.bindContainer(record.expected,id);journal.beginCancelCreated(record.expected,id);journal.close();journal=new ExecutionJournal(root);journal.recoverInterrupted();expect(journal.read(record.expected).state).toBe('cancelling-created');expect(()=>journal.markStartRequested(record.expected)).toThrow('execution_state');expect(()=>journal.recordPhysicalTerminal(record.expected,id,0)).toThrow('execution_state');expect(()=>journal.reserve({...proposal,validationInvocationId:'new'})).toThrow('execution_active');expect(()=>journal.recordCancelledCreated(record.expected,'e'.repeat(64))).toThrow();journal.recordCancelledCreated(record.expected,id);expect(journal.read(record.expected)).toMatchObject({state:'terminal',containerId:id});expect(journal.read(record.expected).exitCode).toBeUndefined();}
 finally{journal.close();rmSync(root,{recursive:true,force:true});}
});
it('recovery forces old created into cancellation, but no started/unknown execution may use that cancellation',()=>{
 const root=mkdtempSync(join(tmpdir(),'created-recovery-'));let journal=new ExecutionJournal(root);const id='f'.repeat(64);
 try{const r=journal.reserve(proposal);journal.beginDispatch(r.expected);journal.bindContainer(r.expected,id);journal.close();journal=new ExecutionJournal(root);journal.recoverInterrupted();expect(journal.read(r.expected).state).toBe('cancelling-created');journal.recordCancelledCreated(r.expected,id);const next=journal.reserve({...proposal,validationInvocationId:'new'});journal.beginDispatch(next.expected);journal.bindContainer(next.expected,id);journal.markStartRequested(next.expected);expect(()=>journal.beginCancelCreated(next.expected,id)).toThrow('execution_state');journal.markUnknown(next.expected);expect(()=>journal.beginCancelCreated(next.expected,id)).toThrow('execution_state');}
 finally{journal.close();rmSync(root,{recursive:true,force:true});}
});
it('terminal history does not consume active 4096 slots, while full tuples stay in the byte-budgeted database',()=>{
 const root=mkdtempSync(join(tmpdir(),'execution-history-')),db=openPrivateVerificationDatabase(root),journal=new ExecutionJournal({database:db});
 try{const original=journal.reserve(proposal);journal.cancelPrepared(original.expected);const insert=db.prepare("INSERT INTO execution_attempts VALUES(?,?,?,?,'terminal',NULL,NULL)");db.transaction(()=>{for(let n=1;n<4096;n++)insert.run('history-'+n,'history','operation-'+n,JSON.stringify({...proposal,sessionIdentity:'history',compoundOperationId:'operation-'+n,validationInvocationId:'v-'+n}));})();expect(journal.reserve({...proposal,validationInvocationId:'new'}).state).toBe('prepared');expect(db.prepare('SELECT COUNT(*) n FROM execution_attempts').get()).toEqual({n:4097});expect(journal.reserve(proposal).expected).toEqual(original.expected);}
 finally{journal.close();db.close();rmSync(root,{recursive:true,force:true});}
});
