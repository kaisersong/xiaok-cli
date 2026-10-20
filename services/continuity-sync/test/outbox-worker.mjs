import fs from 'node:fs';
import { AuthorityJournal } from '../src/journal.mjs';
import { CryptoOutbox } from '../src/outbox.mjs';
import { canonical } from '../src/crypto.mjs';
const args=JSON.parse(fs.readFileSync(0,'utf8'));
function barrier(stage){if(stage!==args.stage)return;const fd=fs.openSync(args.marker,'wx',0o600);fs.writeFileSync(fd,stage);fs.fsyncSync(fd);fs.closeSync(fd);Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);}
const guard={kind:'test-only',read(){return JSON.parse(fs.readFileSync(args.guardFile,'utf8'));},advance(expected,next){if(canonical(this.read())!==canonical(expected))throw new Error('guard_conflict');const fd=fs.openSync(args.guardFile,'w',0o600);fs.writeFileSync(fd,canonical(next));fs.fsyncSync(fd);fs.closeSync(fd);}};
const context={...args.context,...Object.fromEntries(['contentKey','salt','signingKey'].map(k=>[k,new Uint8Array(Buffer.from(args.context[k],'base64url'))]))};
const journal=new AuthorityJournal(args.options),box=new CryptoOutbox({journal,guard,testOnly:true,keyProvider:()=>context,fault:barrier});
box.reserve({eventId:'event1',payload:{text:'same logical input'},parentRevision:0,eventType:'message'});box.seal('event1');box.takeReady('event1');journal.close();
