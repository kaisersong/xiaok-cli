import { existsSync, readFileSync } from 'node:fs';
import { mkdir, open, link, unlink } from 'node:fs/promises';
import { userInfo } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const ROOM_WORKSPACE_PROTOCOL = 'room_workspace_v1';
type ProtocolOptions = { minimumPath?: string };
type Minimum = { schemaVersion: 1; requiredProtocols: string[]; enabledAt: string };
type Probe = () => Promise<unknown>;

/** Deliberately independent of Electron userData, profile and HOME overrides. */
export function resolveRoomWorkspaceMinimumPath(options: { platform?: NodeJS.Platform; osHome?: string } = {}): string {
  const platform=options.platform??process.platform;
  const home=options.osHome??userInfo().homedir;
  if(platform==='win32')return path.win32.join(home,'AppData','Local','xiaok','room-workspace','minimum-protocol.json');
  if(platform==='darwin')return path.posix.join(home,'Library','Application Support','xiaok','room-workspace','minimum-protocol.json');
  return path.posix.join(home,'.local','state','xiaok','room-workspace','minimum-protocol.json');
}
function minimum(options: ProtocolOptions): Minimum | null {
  const file=options.minimumPath??resolveRoomWorkspaceMinimumPath();
  if(!existsSync(file))return null;
  try {
    const value=JSON.parse(readFileSync(file,'utf8')) as Minimum;
    if(value.schemaVersion!==1||!Array.isArray(value.requiredProtocols)||value.requiredProtocols.length===0||value.requiredProtocols.some(p=>p!==ROOM_WORKSPACE_PROTOCOL))throw new Error();
    return value;
  } catch { throw new Error('workspace_protocol_downgrade_forbidden'); }
}
export function supportsRoomWorkspaceProtocol(input: unknown): boolean {
  if(!input||typeof input!=='object')return false;
  const value=input as {ok?:boolean;protocols?:Record<string,unknown>};
  if(value.ok===false)return false;
  const protocol=value.protocols?.[ROOM_WORKSPACE_PROTOCOL] as Record<string,unknown>|undefined;
  return protocol?.contextVersion===1&&protocol.resultVersion===1&&protocol.releaseVersion===1;
}

/** New baseline main calls this before starting services. */
export function assertRoomWorkspaceStartupProtocol(options: ProtocolOptions = {}): void { minimum(options); }

/** Never starts/kills a process. Caller checks before its authorized spawn. */
export function assertRoomWorkspaceSidecarProtocol(entryPath:string,component:'kswarm'|'intent-broker',options:ProtocolOptions={}):void {
  if(!minimum(options))return;
  const candidates=[path.join(path.dirname(entryPath),'room-workspace-protocol.json'),path.join(path.dirname(path.dirname(entryPath)),'room-workspace-protocol.json')];
  for(const candidate of candidates){
    if(!existsSync(candidate))continue;
    try { const marker=JSON.parse(readFileSync(candidate,'utf8')) as {component?:string}; if(marker.component===component&&supportsRoomWorkspaceProtocol(marker))return; } catch { /* deny below */ }
  }
  throw new Error('workspace_protocol_downgrade_forbidden');
}

/** Live probes are required on every activation, including after a baseline was
 * persisted. Package version strings or a previous successful probe are not proof. */
export async function ensureRoomWorkspaceProtocol(options:ProtocolOptions&{brokerProbe:Probe;kswarmProbe:Probe}):Promise<void>{
  const previous=minimum(options);
  const probes=await Promise.allSettled([options.brokerProbe(),options.kswarmProbe()]);
  if(probes.some(p=>p.status!=='fulfilled'||!supportsRoomWorkspaceProtocol(p.value)))throw new Error('workspace_protocol_unavailable');
  if(previous)return;
  const file=options.minimumPath??resolveRoomWorkspaceMinimumPath();
  await mkdir(path.dirname(file),{recursive:true,mode:0o700});
  const temporary=path.join(path.dirname(file),`.minimum-${randomUUID()}.tmp`);
  const content:Minimum={schemaVersion:1,requiredProtocols:[ROOM_WORKSPACE_PROTOCOL],enabledAt:new Date().toISOString()};
  const handle=await open(temporary,'wx',0o600);
  try { await handle.writeFile(JSON.stringify(content)+'\n','utf8');await handle.sync(); } finally { await handle.close(); }
  try {
    // Publish without replacement: a concurrent future minimum cannot be erased.
    try { await link(temporary,file); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;minimum(options); }
    await unlink(temporary);
  } catch(error) { await unlink(temporary).catch(()=>{});throw error; }
}
