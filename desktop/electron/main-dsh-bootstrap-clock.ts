import type {GithubProviderDateFact} from './dsh-github-source-session.js';
import type {MainDshKernelClockCut,MainDshClockView} from './main-dsh-bootstrap-types.js';
const parseClockDate=Date.parse,clockInteger=Number.isSafeInteger,clockAbs=Math.abs,clockMax=Math.max,freeze=Object.freeze,NativeError=Error;
function denied():never{throw new NativeError('DSH_MAIN_NATIVE_AUTHORITY_REQUIRED');}
export function createOriginalMainDshOperationalClock(clock:()=>Readonly<MainDshKernelClockCut>|null,current:()=>void,local:()=>void){
  type Anchor={ref:string;nativeDomain:string;upperMs:number;continuousUpper:bigint;continuousLower:bigint;epoch:number};
  let anchor:Anchor|undefined,clockEpoch=0,clockLastNow=0,clockLost=false;
  const millis=(ns:bigint)=>Number((ns+999999n)/1000000n);
  const observeClock=(fact:GithubProviderDateFact):void=>{
   const cut=fact.localClockCut;if(!cut)return;
   const before=cut.before,after=cut.after;
   if(before.domainId!==after.domainId)return;
   const begin=BigInt(before.continuousLowerNs),end=BigInt(after.continuousUpperNs);
   if(end<begin||end-begin>30000000000n)return;
   const serverUpper=parseClockDate(fact.exclusiveSecondUpperBound),rtt=millis(end-begin),upperMs=serverUpper+rtt;
   // Explicit operational product policy approved by the user: this five minute
   // sanity window is not a provider accuracy guarantee or event-clock proof.
   if(!clockInteger(upperMs)||upperMs<0||upperMs>253402300799999||clockAbs(after.wallMs-serverUpper)>300000)return;
   if(anchor?.ref===fact.factRef)return;
   if(anchor&&anchor.nativeDomain!==after.domainId){clockLost=true;return;}
   if(!anchor||clockLost){clockEpoch++;clockLost=false;}
   const carried=anchor?anchor.upperMs+millis(end-anchor.continuousUpper):0;
   anchor={ref:fact.factRef,nativeDomain:after.domainId,upperMs:clockMax(upperMs,after.wallMs,carried,clockLastNow),continuousUpper:end,continuousLower:BigInt(after.continuousLowerNs),epoch:clockEpoch};
  };
  const clockView=():MainDshClockView=>{
   const cut=clock();
   const unknown=()=>freeze({projection:freeze({state:'unverified' as const}),assertCurrent:current,assertLocal:local});
   if(!cut||!anchor||clockLost)return unknown();
   const captured=anchor,nowLower=BigInt(cut.continuousLowerNs),nowUpper=BigInt(cut.continuousUpperNs);
   if(cut.domainId!==captured.nativeDomain||nowLower<captured.continuousLower||nowUpper-captured.continuousUpper>60000000000n){clockLost=true;return unknown();}
   // The operational provider anchor may lead local time, but must never
   // postpone a local deadline when the provider Date happens to lag it.
   const nowMs=clockMax(clockLastNow,cut.wallMs,captured.upperMs+millis(nowUpper-captured.continuousLower));
   if(!clockInteger(nowMs)||nowMs>253402300799999||clockAbs(cut.wallMs-nowMs)>300000){clockLost=true;return unknown();}
   clockLastNow=nowMs;
   const assertLocal=()=>{local();if(clockLost||!anchor||anchor.epoch!==captured.epoch||anchor.nativeDomain!==captured.nativeDomain)denied();};
   const assertCurrent=()=>{current();const fresh=clock();if(!fresh||fresh.domainId!==captured.nativeDomain||BigInt(fresh.continuousLowerNs)<nowLower||BigInt(fresh.continuousUpperNs)-nowUpper>1000000000n){clockLost=true;denied();}assertLocal();};
   return freeze({projection:freeze({state:'verified' as const,domainId:'operational-server-time-v1:'+cut.domainId,qualificationEpoch:captured.epoch,nowMs}),assertCurrent,assertLocal});
  };
  return freeze({observeClock,clockView});
}
