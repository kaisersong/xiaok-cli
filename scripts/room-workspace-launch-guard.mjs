import { existsSync, readFileSync } from 'node:fs';
import { userInfo } from 'node:os';
import path from 'node:path';

// The stable launcher runs before the target app's code exists. It deliberately
// uses only Node builtins and the published capability/required-protocol schema.
export function assertWorkspaceLaunchProtocol({ bundlePath, platform=process.platform, osHome=userInfo().homedir, minimumPath, development=false }) {
  const p=platform==='win32'?path.win32:path.posix;
  const minimumFile=minimumPath??(platform==='win32'
    ?p.join(osHome,'AppData','Local','xiaok','room-workspace','minimum-protocol.json')
    :platform==='darwin'?p.join(osHome,'Library','Application Support','xiaok','room-workspace','minimum-protocol.json')
    :p.join(osHome,'.local','state','xiaok','room-workspace','minimum-protocol.json'));
  if(!existsSync(minimumFile))return;
  try {
    const minimum=JSON.parse(readFileSync(minimumFile,'utf8'));
    if(minimum.schemaVersion!==1||!Array.isArray(minimum.requiredProtocols)||minimum.requiredProtocols.length===0||minimum.requiredProtocols.some(protocol=>protocol!=='room_workspace_v1'))throw new Error();
    const markerPath=development?p.join(bundlePath,'resources','room-workspace-protocol.json')
      :platform==='darwin'?p.join(bundlePath,'Contents','Resources','room-workspace-protocol.json')
      :p.join(bundlePath,'resources','room-workspace-protocol.json');
    const marker=JSON.parse(readFileSync(markerPath,'utf8'));
    const protocol=marker.protocols?.room_workspace_v1;
    if(marker.component!=='desktop'||protocol?.contextVersion!==1||protocol.resultVersion!==1||protocol.releaseVersion!==1)throw new Error();
    // A source marker cannot bless a stale development main build.
    if(development&&!existsSync(p.join(bundlePath,'dist','main','desktop','electron','room-workspace-protocol.js')))throw new Error();
  } catch { throw new Error('workspace_protocol_downgrade_forbidden'); }
}
