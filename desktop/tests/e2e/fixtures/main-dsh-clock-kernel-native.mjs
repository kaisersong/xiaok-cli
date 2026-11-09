import {app} from 'electron';
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url),path=process.env.XIAOK_CLOCK_KERNEL_ADDON;
if(!path)throw Error('isolated_clock_addon_required');
app.whenReady().then(async()=>{
 const api=require(path),issuer=api.createOriginalMainIssuer();
 assert.equal(typeof api.readOriginalMainClockCut,'function');
 let traps=0;const fake=new Proxy({},{get(){traps++;throw Error('fake issuer get');},getOwnPropertyDescriptor(){traps++;throw Error('fake issuer descriptor');}});
 assert.throws(()=>api.readOriginalMainClockCut(fake),/ISSUER_REQUIRED/);assert.equal(traps,0);assert.throws(()=>api.readOriginalMainClockCut(),/ARGUMENT_INVALID/);
 const first=api.readOriginalMainClockCut(issuer);assert.equal(first.kind,'main_kernel_clock_cut_v1');assert.equal(Object.getPrototypeOf(first),null);assert.match(first.domainId,/^[a-f0-9]{64}$/);assert(BigInt(first.continuousUpperNs)>=BigInt(first.continuousLowerNs));
 const nativeNow=Date.now;Date.now=()=>0;
 let second;try{await new Promise(yes=>setTimeout(yes,5));second=api.readOriginalMainClockCut(issuer);}finally{Date.now=nativeNow;}
 assert.equal(second.domainId,first.domainId);assert(BigInt(second.continuousLowerNs)>=BigInt(first.continuousUpperNs));assert(second.wallMs>1700000000000);assert(second.wallMs>=first.wallMs);
 api.revokeOriginalMainIssuer(issuer);assert.throws(()=>api.readOriginalMainClockCut(issuer),/REVOKED/);
 console.log(JSON.stringify({fixture:'main-kernel-clock-cut',originalMain:true,stableDomain:true,continuous:true,jsDateCannotForge:true,foreignGetterHits:traps,revoked:true,notUtcQualification:true,notProviderClockBound:true,pid:process.pid}));app.exit(0);
}).catch(error=>{console.error(error);app.exit(1);});
