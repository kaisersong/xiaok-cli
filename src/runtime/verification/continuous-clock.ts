import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {assertRootProtectedExecutable} from './installed-identity.js';
import type {ReceiverClockEvidence} from './receiver-store.js';
/** Raw kernel measurement, not installation qualification. The installed factory
 * below verifies the immutable executable before using its results as local time. */
export function readKernelContinuousNanoseconds(helperExecutable:string):bigint{
 if(!['darwin','linux'].includes(process.platform))throw Error('continuous_clock_platform');
 const result=spawnSync(helperExecutable,[],{cwd:'/',env:{PATH:'/usr/bin:/bin'},encoding:'utf8',timeout:5000,maxBuffer:4096});
 if(result.error||result.status!==0||result.signal)throw Error('continuous_clock_unknown');const v=JSON.parse(result.stdout);
 if(!v||Object.keys(v).sort().join(',')!=='kind,nanoseconds'||v.kind!==(process.platform==='darwin'?'mach-continuous':'linux-boottime')||typeof v.nanoseconds!=='string'||!/^[0-9]{1,20}$/.test(v.nanoseconds))throw Error('continuous_clock_unknown');return BigInt(v.nanoseconds);
}
/** Same-machine protected authority only: no remote/UTC accuracy assertion.
 * Each startup has a fresh domain. Timestamp units are continuous kernel ms,
 * including sleep; the receiver must sample again inside its commit transaction. */
export function createInstalledLocalContinuousClock(helperExecutable:string){
 assertRootProtectedExecutable(helperExecutable);const bytes=readFileSync(helperExecutable),helperHash=createHash('sha256').update(bytes).digest('hex');
 const domainId='continuous-'+randomUUID(),evidenceHash=createHash('sha256').update(JSON.stringify({version:1,platform:process.platform,helperHash,domainId})).digest('hex');let last=0n;
 return Object.freeze({
  domainId,evidenceHash,
  sample():Readonly<ReceiverClockEvidence>{
   assertRootProtectedExecutable(helperExecutable);if(createHash('sha256').update(readFileSync(helperExecutable)).digest('hex')!==helperHash)throw Error('continuous_clock_helper_changed');
   const first=readKernelContinuousNanoseconds(helperExecutable),lastRead=readKernelContinuousNanoseconds(helperExecutable);
   if(first<last||lastRead<first||lastRead-first>5_000_000_000n)throw Error('continuous_clock_unknown');last=lastRead;
   const lowerBound=Number(first/1_000_000n),upperBound=Number((lastRead+999_999n)/1_000_000n);
   if(!Number.isSafeInteger(lowerBound)||!Number.isSafeInteger(upperBound))throw Error('continuous_clock_range');
   return Object.freeze({domainId,qualificationEpoch:1,lowerBound,upperBound,evidenceHash});
  },
 });
}
