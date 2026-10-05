import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {openPrivateVerificationDatabase} from '../../../src/runtime/verification/private-database.js';
import {createPrimitiveBlobAuthority} from '../../support/primitive-blob-authority.js';
import {createMountedEngineProbe} from '../../../src/runtime/isolated-execution/mounted-engine-probe.js';
import {createEngineQualificationCapacityOwner} from '../../../src/runtime/verification/shared-blob-capacity.js';
import {DockerEngineTransport} from '../../../src/runtime/isolated-execution/docker-engine-transport.js';
import * as commands from '../../../src/runtime/verification/execution-command-dispatch.js';
vi.mock('../../../src/runtime/verification/installed-engine.js',()=>({assertInstalledMacEngineHandle(){},assertInstalledEngineDatabase(){},inspectInstalledMacEngineHandle:async()=>{}}));
vi.mock('../../../src/runtime/isolated-execution/docker-engine-transport.js',()=>({DockerEngineTransport:class{async createVolume(){throw Error('actual engine boundary stopped');}async findMountedAttempt(){throw Error('engine unknown');}}}));
for(const mode of ['normal','callback','foreign-qualification','write-failure'] as const)it('mounted fixed command preserves original transaction: '+mode,async()=>{
 const root=mkdtempSync(join(tmpdir(),'mounted-command-')),db=openPrivateVerificationDatabase(root),budget=createPrimitiveBlobAuthority({database:db,authorityId:'mounted-command',assertCurrent(){},deletion:{assertDeleted(){throw Error('no fabricated deletion');}}}).budget,probe=createMountedEngineProbe({database:db,budget,engine:new DockerEngineTransport({socketPath:'/unused.sock'}),capacityOwner:createEngineQualificationCapacityOwner(new DockerEngineTransport({socketPath:'/unused.sock'}),db),engineBinding:{engineId:'dev',incarnation:'dev',epoch:1},imageId:'sha256:'+'a'.repeat(64),assertCurrent(){}}),dispatch=vi.spyOn(commands,'executeExecutionPreparationCommand');let called=0;
 try{
  if(mode==='write-failure')db.exec("CREATE TRIGGER fail_probe BEFORE INSERT ON docker_runner_resources BEGIN SELECT RAISE(ABORT,'original probe write failed'); END");
  if(mode==='callback')await expect(probe.run({commitExpected(){called++;db.exec('COMMIT');}} as never)).rejects.toThrow('mounted_probe_input');
  else if(mode==='foreign-qualification')await expect(probe.run({qualification:{}})).rejects.toThrow('mounted_qualification_identity');
  else await expect(probe.run()).rejects.toThrow(mode==='normal'?'actual engine boundary stopped':'original probe write failed');
  expect(called).toBe(0);expect(dispatch).toHaveBeenCalledTimes(mode==='callback'?0:1);expect(db.inTransaction).toBe(false);
  for(const table of ['execution_attempts','docker_runner_resources'])expect(db.prepare('SELECT COUNT(*) n FROM '+table).get()).toEqual({n:mode==='normal'?1:0});
  expect(db.prepare('SELECT COUNT(*) n FROM verification_blob_reservations').get()).toEqual({n:mode==='normal'?2:0});
 }finally{dispatch.mockRestore();probe.close();budget.close();db.close();rmSync(root,{recursive:true,force:true});}
});
