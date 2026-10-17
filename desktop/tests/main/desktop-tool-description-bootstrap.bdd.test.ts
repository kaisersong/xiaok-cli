// @vitest-environment node
import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createDesktopServices } from '../../electron/desktop-services.js';
import type { KSwarmService } from '../../electron/kswarm-service.js';
it('real Desktop bootstrap tool_search discloses string/read/unknown through actual registry assembly', async()=>{
 const root=mkdtempSync(join(tmpdir(),'desktop-description-bootstrap-'));
 const configBefore=process.env.XIAOK_CONFIG_DIR;
 process.env.XIAOK_CONFIG_DIR=join(root,'config');
 const kswarm: KSwarmService={start:async()=>{},stop:async()=>{},restart:async()=>{},getStatus:()=>({running:true,port:4400,pid:1,restartCount:0,lastError:null}),onStatusChange:()=>()=>{},getDesktopMutationToken:()=>'test-token',getIntentBrokerRoomToken:()=>'test-room-token',getServiceStatus:async()=>{throw new Error('unused service status port');},getHealthDiagnosticInput:async()=>{throw new Error('unused health port');},restartRelatedService:async()=>{},request:async()=>new Response('{}',{status:501})};
 const services=createDesktopServices({dataRoot:join(root,'data'),kswarmService:kswarm});
 try {
  const result=JSON.parse(await services.executeTool('tool_search',{query:'read'}));
  const read=result.find((definition:{name:string})=>definition.name==='read');
  expect(read).toMatchObject({outputSchema:{type:'string'},effect:'read',idempotency:'unknown'});
 } finally {
  await services.disposeMultiAgent();
  await services.closeTaskSourceWritersForMigration();
  await services.closeMaterialRegistryAndArtifactFileManagerInstances();
  await services.sealAndDrainArtifactWorkspaceServiceInstance();
  if(configBefore===undefined)delete process.env.XIAOK_CONFIG_DIR;else process.env.XIAOK_CONFIG_DIR=configBefore;
  rmSync(root,{recursive:true,force:true});
 }
});
