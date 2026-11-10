import fs from 'node:fs';
import { AuthorityJournal } from '../src/journal.mjs';
const opts=JSON.parse(process.env.JOURNAL_OPTIONS);
if(process.argv[2]==='open'){
 try{const j=new AuthorityJournal(opts);j.close();process.exitCode=0;}catch(e){process.exitCode=/owner_unavailable/.test(e.message)?23:24;}
}else{
 const j=new AuthorityJournal({...opts,fault(stage){if(stage===process.env.CRASH_STAGE){const fd=fs.openSync(process.env.CRASH_MARKER,'wx',0o600);fs.writeFileSync(fd,stage);fs.fsyncSync(fd);fs.closeSync(fd);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}}});
 j.transact({operationId:'op1',kind:'fixture',request:{value:1}},tx=>{tx.set('counter',1);return {value:1};});j.close();
}
