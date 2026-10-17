import {expect,it} from 'vitest';
import {join} from 'node:path';
import {loopPublicationFixture} from '../support/loop-publication-fixture.js';
import {DesktopShutdownGate} from '../../electron/shutdown-aware-ipc-main.js';
import {createDesktopLoopPublicationService} from '../../electron/loop-desktop-publication-service.js';
import {createLoopPublicationShutdownOwner} from '../../electron/loop-publication-shutdown.js';
it('actual Loop database cannot close while any original Main writer token remains',async()=>{const f=loopPublicationFixture(),gate=new DesktopShutdownGate(),service=createDesktopLoopPublicationService({store:f.store,workspaceRoot:f.root,sessionRoot:join(f.root,'sessions'),captureAdmission:()=>()=>{},taskPort:{async recoverTask(){return undefined;}}});let closed=0;const owner=createLoopPublicationShutdownOwner(service,gate,()=>{closed++;f.store.close();});try{
 await expect(owner.durable.close()).rejects.toThrow();const original=gate.acquire('external','actual-writer');gate.close();owner.ingress.stopAccepting();await service.close();expect(await owner.ingress.drain(0)).toBe(true);await expect(owner.durable.close()).rejects.toThrow();expect(f.store.getLoopRun(f.candidate.runId)).toBeDefined();original.release();await owner.durable.close();expect(closed).toBe(1);await owner.durable.close();expect(closed).toBe(1);
 }finally{await service.close();try{f.close();}catch{}}});
