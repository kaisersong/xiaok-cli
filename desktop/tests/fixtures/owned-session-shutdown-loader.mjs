import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const OWNED_SESSION_SOURCE=Object.freeze({path:'desktop/electron/desktop-managed-agent-session.ts',sha256:'a12fac535b7d9372ba3c0a871a6f5390427dd02ef003b64670eb0ba7f5a2ac94'});
const hash=source=>createHash('sha256').update(source).digest('hex');
const marker='  private async disposeOwned():';
const suspendFrom='    await waitDesktopModelPhysicalIdle(this.modelPhysicalScope);';
const suspendTo='    try { await waitDesktopModelPhysicalIdle(this.modelPhysicalScope); }\n    catch (error) { observeOwnedSessionSuspendFailure(this, error); throw error; }';
const transforms=Object.freeze([
 ['await this.observed.child.execution?.dispose();',"await observeOwnedSessionStop(this, 'execution', () => this.observed!.child.execution?.dispose());"],
 ['await this.observed.host.drainTransport();',"await observeOwnedSessionStop(this, 'transport', () => this.observed!.host.drainTransport());"],
 ['    this.scope?.dispose(); this.scope = undefined;', '    observeOwnedSessionTail(this);\n    this.scope?.dispose(); this.scope = undefined;'],
]);
function prefix(url){if(typeof url!=='string'||!url.startsWith('file:')||new URL(url).protocol!=='file:')throw Error('owned_session_probe_url');return `import {observeOwnedSessionStop,observeOwnedSessionTail,observeOwnedSessionSuspendFailure} from ${JSON.stringify(url)};\n`;}
function once(source,from,to){if(source.split(from).length!==2)throw Error('owned_session_probe_anchor');return source.replace(from,to);}
export function instrumentOwnedSessionShutdown(source,url){
 const header=prefix(url);if(hash(source)!==OWNED_SESSION_SOURCE.sha256)throw Error('owned_session_probe_source_changed');
 const at=source.indexOf(marker);if(at<0)throw Error('owned_session_probe_anchor');
 let tail=source.slice(at);for(const [from,to]of transforms)tail=once(tail,from,to);
 const before=once(source.slice(0,at),suspendFrom,suspendTo);
 return header+before+tail;
}
export function restoreOwnedSessionShutdown(source,url){
 const header=prefix(url);if(!source.startsWith(header))throw Error('owned_session_probe_restore_changed');
 let restored=once(source.slice(header.length),suspendTo,suspendFrom);for(const [from,to]of [...transforms].reverse())restored=once(restored,to,from);
 if(hash(restored)!==OWNED_SESSION_SOURCE.sha256)throw Error('owned_session_probe_restore_changed');return restored;
}
export function createOwnedSessionShutdownPlugin({repoRoot,runNonce}){
 if(typeof runNonce!=='string'||!/^[a-f0-9]{32}$/.test(runNonce))throw Error('owned_session_probe_run_nonce');
 const sourcePath=resolve(repoRoot,OWNED_SESSION_SOURCE.path),url=pathToFileURL(resolve(repoRoot,'desktop/tests/fixtures/owned-session-shutdown-probe.mjs')).href;
 return {name:'one-owned-session-shutdown-case',enforce:'pre',load(id){
  if(resolve(id.split('?')[0])!==sourcePath)return;
  const original=readFileSync(sourcePath,'utf8'),changed=instrumentOwnedSessionShutdown(original,url);
  if(restoreOwnedSessionShutdown(changed,url)!==original)throw Error('owned_session_probe_roundtrip');return changed;
 }};
}
