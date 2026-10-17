// @vitest-environment node
import {afterEach,describe,expect,it,vi} from 'vitest';
import {mkdtempSync,realpathSync,lstatSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import type {Tool} from '../../../src/types.js';import {buildToolList} from '../../../src/ai/tools/index.js';
import {getBuiltinToolIdentity} from '../../../src/ai/tools/native-tool-identity.js';
import {DesktopOwnedToolRegistry,DesktopToolCatalogBridge} from '../../electron/desktop-multi-agent-catalog-bridge.js';
import {DesktopCapabilityCatalog,type DesktopCapabilityEntry} from '../../electron/desktop-multi-agent-capabilities.js';
import {createRoomToolRegistry,runRoomWorkspaceExecutor,type RoomWorkspaceExecutionContext,type WorkspaceExecutionPort} from '../../electron/room-workspace-executor.js';
const metadata={outputSchema:{type:'string'},effect:'read',idempotency:'unknown'} as const;
const tool=(name='cap'):Tool=>({definition:{name,description:'source',inputSchema:{type:'object',properties:{}}},permission:'safe',execute:async()=>'RESULT'});
const authority=(cwd:string)=>({groupId:'g',agentId:'root_g',turnId:'t',cwd,workspaceId:'w',materialIds:[],permissionRevision:0,signal:new AbortController().signal,deadlineAt:Date.now()+60000});
const entry=(t:Tool):DesktopCapabilityEntry=>({definition:t.definition,aliases:['alias_cap'],permission:t.permission,verifiedReadOnly:true,scope:{workspaceId:'w',materialIds:[],permissions:['safe']},bindInvocation:()=>t.execute});
const context=(cwd:string):RoomWorkspaceExecutionContext=>{const canonicalRoot=realpathSync(cwd),s=lstatSync(canonicalRoot,{bigint:true});return {roomId:'r',logicalAgentId:'a',runId:'run',claimId:'claim',executorInstanceId:'e',workspaceId:'w',bindingId:'b',generation:1,instructionsRevision:1,effectiveCwd:cwd,workspaceRoot:{canonicalRoot,identity:{dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)}},publishedInstructions:'rules',contextScope:{kind:'room_only'}};};
const port=():WorkspaceExecutionPort=>({authorize:vi.fn(async()=>{}),acquireChild:vi.fn(async({parent})=>parent),release:vi.fn(async()=>{}),submitManifest:vi.fn(async()=>{})});
describe('Desktop explicit descriptive sidecar real entries',()=>{
 const cleanup:Array<()=>void>=[];afterEach(()=>{for(const fn of cleanup.splice(0).reverse())fn();});const temp=()=>{const p=mkdtempSync(join(tmpdir(),'desktop-description-'));cleanup.push(()=>rmSync(p,{recursive:true,force:true}));return p;};
 it('Owned constructor uses paired source object and legacy core remains exact',()=>{
  const source=tool('read'),registry=new DesktopOwnedToolRegistry({autoMode:true},[source],new Map([[source,metadata]]));cleanup.push(()=>registry.dispose());
  expect(registry.getToolDefinitions().find(d=>d.name==='read')).toBe(source.definition);expect(Object.keys(source.definition)).toEqual(['name','description','inputSchema']);expect(registry.getToolDiscoveries().find(d=>d.coreDefinition.name==='read')?.metadata).toEqual(metadata);
  const other=tool('read'),legacy=new DesktopOwnedToolRegistry({autoMode:true},[other],new Map([[source,metadata]]));cleanup.push(()=>legacy.dispose());expect(legacy.getToolDiscoveries().find(d=>d.coreDefinition.name==='read')).toEqual({coreDefinition:other.definition});
 });
 it('same Tool refresh reaches authorized scope without replacing capability or wrapper',async()=>{
  const source=tool(),registry=new DesktopOwnedToolRegistry({autoMode:true},[]);cleanup.push(()=>registry.dispose());registry.registerOwnedTool(source,{ownerId:'server',slotKey:'cap',binding:'independent'},metadata);
  const bridge=new DesktopToolCatalogBridge({registry,workspaceId:'w'});cleanup.push(()=>bridge.dispose());bridge.authorizeRoot();const descriptor=bridge.catalog.snapshotDescriptors()[0],scope=bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(),authority(temp()),{autoMode:true});cleanup.push(()=>scope.dispose());const wrapper=scope.registry.getRegisteredTool('cap');
  expect(scope.registry.getToolDiscoveries().find(d=>d.coreDefinition.name==='cap')?.metadata).toEqual(metadata);registry.registerOwnedTool(source,{ownerId:'server',slotKey:'cap',binding:'independent'},{effect:'unknown'});expect(bridge.catalog.snapshotDescriptors()[0]).toBe(descriptor);expect(scope.registry.getRegisteredTool('cap')).toBe(wrapper);expect(scope.registry.getToolDiscoveries().find(d=>d.coreDefinition.name==='cap')?.metadata).toEqual({effect:'unknown'});expect(await scope.registry.executeTool('cap',{})).toBe('RESULT');
  registry.registerOwnedTool(source,{ownerId:'server',slotKey:'cap',binding:'independent'});expect(scope.registry.getToolDiscoveries().find(d=>d.coreDefinition.name==='cap')).toEqual({coreDefinition:wrapper!.definition});
 });
 it('invalid explicit metadata changes no ownership or notifications and calls no getter',()=>{
  const registry=new DesktopOwnedToolRegistry({autoMode:true},[]);cleanup.push(()=>registry.dispose());const changed=vi.fn();registry.subscribeToolsChanged(changed);let getters=0;expect(()=>registry.registerOwnedTool(tool(),{ownerId:'server',slotKey:'cap',binding:'independent'},{get effect(){getters++;return 'read';}} as never)).toThrow();expect(getters).toBe(0);expect(changed).not.toHaveBeenCalled();expect(registry.ownerOf('cap')).toBeUndefined();expect(registry.getRegisteredTool('cap')).toBeUndefined();
 });
 it('catalog sidecar is separate and refresh preserves canonical and alias wrappers',async()=>{
  const catalog=new DesktopCapabilityCatalog(),descriptor=catalog.publish({requestSource:'scheduler',ownerId:'server',entry:entry(tool())},metadata);catalog.authorize({requestSource:'user',capabilityId:descriptor.capabilityId});const scope=catalog.createScopedRegistry(catalog.snapshotPolicy(),authority(temp()),{autoMode:true});cleanup.push(()=>scope.dispose());const wrappers=['cap','alias_cap'].map(n=>scope.registry.getRegisteredTool(n));expect(Object.keys(descriptor)).not.toContain('metadata');expect(catalog.getDiscovery(descriptor.capabilityId)).toEqual({coreDefinition:descriptor.definition,metadata});
  catalog.refreshDescription({requestSource:'scheduler',ownerId:'server',capabilityId:descriptor.capabilityId},{effect:'none'});for(const [i,name] of ['cap','alias_cap'].entries()){expect(scope.registry.getRegisteredTool(name)).toBe(wrappers[i]);expect(scope.registry.getToolDiscoveries().find(d=>d.coreDefinition.name===name)?.metadata).toEqual({effect:'none'});expect(await scope.registry.executeTool(name,{})).toBe('RESULT');}
 });
 it('catalog rejects wrong source owner stale identity and Proxy without changes or traps',()=>{
  const catalog=new DesktopCapabilityCatalog(),descriptor=catalog.publish({requestSource:'scheduler',ownerId:'server',entry:entry(tool())},metadata),before=catalog.getDiscovery(descriptor.capabilityId);let traps=0;const proxy=new Proxy({}, {ownKeys(){traps++;return [];}});
  expect(()=>catalog.refreshDescription({requestSource:'scheduler',ownerId:'other',capabilityId:descriptor.capabilityId},{effect:'none'})).toThrow();expect(()=>catalog.refreshDescription({requestSource:'agent',ownerId:'server',capabilityId:descriptor.capabilityId},{effect:'none'})).toThrow();expect(()=>catalog.refreshDescription({requestSource:'scheduler',ownerId:'server',capabilityId:descriptor.capabilityId},proxy)).toThrow();expect(traps).toBe(0);expect(catalog.getDiscovery(descriptor.capabilityId)).toEqual(before);catalog.revoke({requestSource:'scheduler',ownerId:'server'});expect(catalog.getDiscovery(descriptor.capabilityId)).toBeUndefined();expect(()=>catalog.refreshDescription({requestSource:'scheduler',ownerId:'server',capabilityId:descriptor.capabilityId},metadata)).toThrow();
 });
 it('read description cannot grant authorization or readonly provenance',()=>{
  const catalog=new DesktopCapabilityCatalog(),descriptor=catalog.publish({requestSource:'scheduler',ownerId:'server',entry:{...entry(tool('read')),verifiedReadOnly:false}},metadata);const denied=catalog.createScopedRegistry(catalog.snapshotPolicy(),authority(temp()),{autoMode:true});cleanup.push(()=>denied.dispose());expect(denied.registry.getRegisteredTool('read')).toBeUndefined();catalog.authorize({requestSource:'user',capabilityId:descriptor.capabilityId});const allowed=catalog.createScopedRegistry(catalog.snapshotPolicy(),authority(temp()),{autoMode:true});cleanup.push(()=>allowed.dispose());expect(getBuiltinToolIdentity(allowed.registry.getRegisteredTool('read')!)).toBeUndefined();
 });
 it('Room explicit paired metadata crosses wrapper while original authorization still denies',async()=>{
  const cwd=temp(),source=buildToolList(undefined,{cwd}).find(t=>t.definition.name==='read')!,p=port(),registry=createRoomToolRegistry({mode:'workspace',tools:[source],metadata:new Map([[source,metadata]]),context:context(cwd),port:p});cleanup.push(()=>registry.dispose());writeFileSync(join(cwd,'in.txt'),'VALUE');expect(registry.getToolDiscoveries().find(d=>d.coreDefinition.name==='read')?.metadata).toEqual(metadata);expect(registry.getRegisteredTool('read')?.definition).toBe(source.definition);expect(await registry.executeTool('read',{file_path:'in.txt'})).toContain('VALUE');vi.mocked(p.authorize).mockRejectedValue(new Error('revoked'));expect(await registry.executeTool('read',{file_path:'in.txt'})).toContain('revoked');await registry.drain();
 });
 it('Room legacy, unrelated same name and excluded allowlist never inherit metadata',()=>{
  const cwd=temp(),source=tool('read');for(const options of [{tools:[source]},{tools:[tool('read')],metadata:new Map([[source,metadata]])},{tools:[source],metadata:new Map([[source,metadata]]),allowedTools:['glob']}]){const registry=createRoomToolRegistry({mode:'workspace',...options,context:context(cwd),port:port()});cleanup.push(()=>registry.dispose());expect(registry.getToolDiscoveries().find(d=>d.coreDefinition.name==='read')?.metadata).toBeUndefined();}
 });
 it('Room invalid metadata refuses registration before reading getters',()=>{
  const registry=createRoomToolRegistry({mode:'workspace',tools:[],context:context(temp()),port:port()});cleanup.push(()=>registry.dispose());let getters=0;expect(()=>registry.registerTool(tool('read'),{get effect(){getters++;return 'read';}} as never)).toThrow();expect(getters).toBe(0);expect(registry.getRegisteredTool('read')).toBeUndefined();
 });
 it('actual Room executor assembly discovers string read unknown and provider shape stays legacy',async()=>{
  const cwd=temp();let visited=false;await runRoomWorkspaceExecutor({context:context(cwd),port:port(),prompt:'root',createRunner:({registry})=>async()=>{visited=true;const discovery=registry.getToolDiscoveries().find(d=>d.coreDefinition.name==='read');expect(discovery?.metadata).toEqual(metadata);expect(Object.keys(discovery!.coreDefinition)).toEqual(['name','description','inputSchema']);return;}});expect(visited).toBe(true);
 });
});
