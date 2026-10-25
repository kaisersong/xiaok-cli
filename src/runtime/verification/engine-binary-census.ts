/** Checks facts from the fixed service-private guest census, not caller claims.
 * This parser alone grants no engine or OS qualification. */
const names=['containerd','containerd-shim-runc-v2','ctr','docker','docker-init','docker-proxy','dockerd','runc'];
export function verifyEngineBinaryCensus(expected:readonly {name:string;sha256:string;size:number}[],raw:string):void{
 if(!Array.isArray(expected)||expected.length!==names.length||typeof raw!=='string'||Buffer.byteLength(raw)>16384)throw Error('engine_binary_census');
 const ordered=[...expected].sort((a,b)=>a.name.localeCompare(b.name,'en'));
 if(ordered.map(x=>x.name).join(',')!==names.join(',')||ordered.some(x=>Object.keys(x).sort().join(',')!=='name,sha256,size'||!/^[a-f0-9]{64}$/.test(x.sha256)||!Number.isSafeInteger(x.size)||x.size<1))throw Error('engine_binary_manifest');
 const lines=raw.trimEnd().split('\n');if(lines.length!==names.length)throw Error('engine_binary_census');
 for(let i=0;i<names.length;i++){const x=ordered[i];if(lines[i]!==`${x.name} ${x.sha256} 0 0 755 1 ${x.size}`)throw Error('engine_binary_changed');}
}
export const ENGINE_BINARY_CENSUS_SCRIPT=`set -eu
for name in containerd containerd-shim-runc-v2 ctr docker docker-init docker-proxy dockerd runc; do
 path=/usr/local/lib/xiaok-engine/$name
 [ ! -L "$path" ] && [ -f "$path" ]
 printf '%s %s %s\\n' "$name" "$(sha256sum "$path" | cut -d ' ' -f 1)" "$(stat -c '%u %g %a %h %s' "$path")"
done
`;
