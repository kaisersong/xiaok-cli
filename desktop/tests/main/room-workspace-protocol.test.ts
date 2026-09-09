import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ensureRoomWorkspaceProtocol, assertRoomWorkspaceStartupProtocol, assertRoomWorkspaceSidecarProtocol, resolveRoomWorkspaceMinimumPath } from '../../electron/room-workspace-protocol.js';

const paths:string[]=[];
const capability={protocols:{room_workspace_v1:{contextVersion:1,resultVersion:1,releaseVersion:1}}};
afterEach(async()=>{await Promise.all(paths.splice(0).map(p=>rm(p,{recursive:true,force:true})));});
async function temporary(){const p=await mkdtemp(path.join(tmpdir(),'workspace-protocol-'));paths.push(p);return p;}
describe('Room workspace supported deployment baseline',()=>{
  it('verifies both live services before persisting minimum and never infers capability from version',async()=>{
    const dir=await temporary();const minimumPath=path.join(dir,'minimum.json');
    await expect(ensureRoomWorkspaceProtocol({minimumPath,brokerProbe:async()=>({ok:true,version:'99.0.0'}),kswarmProbe:async()=>capability})).rejects.toThrow('workspace_protocol_unavailable');
    await expect(readFile(minimumPath)).rejects.toThrow();
    await ensureRoomWorkspaceProtocol({minimumPath,brokerProbe:async()=>capability,kswarmProbe:async()=>capability});
    expect(JSON.parse(await readFile(minimumPath,'utf8')).requiredProtocols).toEqual(['room_workspace_v1']);
    expect(()=>assertRoomWorkspaceStartupProtocol({minimumPath})).not.toThrow();
  });
  it('rejects unknown/corrupt minimum before startup and never downgrades it',async()=>{
    const minimumPath=path.join(await temporary(),'minimum.json');
    await writeFile(minimumPath,JSON.stringify({schemaVersion:1,requiredProtocols:['future_v2']}));
    expect(()=>assertRoomWorkspaceStartupProtocol({minimumPath})).toThrow('workspace_protocol_downgrade_forbidden');
    await expect(ensureRoomWorkspaceProtocol({minimumPath,brokerProbe:async()=>capability,kswarmProbe:async()=>capability})).rejects.toThrow('workspace_protocol_downgrade_forbidden');
    expect(JSON.parse(await readFile(minimumPath,'utf8')).requiredProtocols).toEqual(['future_v2']);
  });
  it('sidecar target requires actual capability marker only once baseline is active',async()=>{
    const dir=await temporary();const minimumPath=path.join(dir,'minimum.json');const entry=path.join(dir,'service','src','cli.js');
    await mkdir(path.dirname(entry),{recursive:true});await writeFile(entry,'');
    expect(()=>assertRoomWorkspaceSidecarProtocol(entry,'intent-broker',{minimumPath})).not.toThrow();
    await ensureRoomWorkspaceProtocol({minimumPath,brokerProbe:async()=>capability,kswarmProbe:async()=>capability});
    expect(()=>assertRoomWorkspaceSidecarProtocol(entry,'intent-broker',{minimumPath})).toThrow('workspace_protocol_downgrade_forbidden');
    await writeFile(path.join(path.dirname(entry),'room-workspace-protocol.json'),JSON.stringify({...capability,component:'intent-broker'}));
    expect(()=>assertRoomWorkspaceSidecarProtocol(entry,'intent-broker',{minimumPath})).not.toThrow();
  });
  it('stable OS-user location ignores Desktop profiles and preserves Windows path syntax',()=>{
    expect(resolveRoomWorkspaceMinimumPath({platform:'win32',osHome:'C:\\Users\\test'})).toBe('C:\\Users\\test\\AppData\\Local\\xiaok\\room-workspace\\minimum-protocol.json');
    expect(resolveRoomWorkspaceMinimumPath({platform:'darwin',osHome:'/test/user'})).toBe('/test/user/Library/Application Support/xiaok/room-workspace/minimum-protocol.json');
    expect(resolveRoomWorkspaceMinimumPath({platform:'linux',osHome:'/test/user'})).toBe('/test/user/.local/state/xiaok/room-workspace/minimum-protocol.json');
  });
  it('stable launcher refuses an older app bundle before spawn',async()=>{
    const dir=await temporary();const minimumPath=path.join(dir,'minimum.json');
    await ensureRoomWorkspaceProtocol({minimumPath,brokerProbe:async()=>capability,kswarmProbe:async()=>capability});
    // @ts-expect-error standalone Node launcher module intentionally has no app dependency
    const {assertWorkspaceLaunchProtocol}=await import('../../../scripts/room-workspace-launch-guard.mjs');
    const bundlePath=path.join(dir,'xiaok.app');
    expect(()=>assertWorkspaceLaunchProtocol({bundlePath,platform:'darwin',minimumPath})).toThrow('workspace_protocol_downgrade_forbidden');
    await mkdir(path.join(bundlePath,'Contents','Resources'),{recursive:true});
    await writeFile(path.join(bundlePath,'Contents','Resources','room-workspace-protocol.json'),JSON.stringify({...capability,component:'desktop'}));
    expect(()=>assertWorkspaceLaunchProtocol({bundlePath,platform:'darwin',minimumPath})).not.toThrow();
  });
});
