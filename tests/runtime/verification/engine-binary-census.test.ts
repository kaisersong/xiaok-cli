import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {verifyEngineBinaryCensus} from '../../../src/runtime/verification/engine-binary-census.js';
const names=['containerd','containerd-shim-runc-v2','ctr','docker','docker-init','docker-proxy','dockerd','runc'];
it('rejects changed fixed binary despite an otherwise unchanged active unit and rejects owner/mode/link drift',()=>{
 const files=names.map(name=>({name,sha256:createHash('sha256').update(name).digest('hex'),size:Buffer.byteLength(name)}));
 const lines=files.map(x=>`${x.name} ${x.sha256} 0 0 755 1 ${x.size}`).join('\n')+'\n';
 expect(()=>verifyEngineBinaryCensus(files,lines)).not.toThrow();
 expect(()=>verifyEngineBinaryCensus(files,lines.replace(files[0].sha256,'f'.repeat(64)))).toThrow('engine_binary_changed');
 for(const tuple of ['500 0 755 1','0 0 777 1','0 0 755 2'])expect(()=>verifyEngineBinaryCensus(files,lines.replace('0 0 755 1',tuple))).toThrow('engine_binary_changed');
 expect(()=>verifyEngineBinaryCensus(files,lines.split('\n').slice(1).join('\n'))).toThrow();
});
