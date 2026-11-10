import type {RoomTurnCustody} from './original-sdk-custody.js';
import type {ProfileSourceReview} from './profile-source-review.js';
import type {ProfileSourceApprovalReceipt} from './profile-source-authorization.js';
import type {SourceCustodyPeer} from './profile-source-custody-registry.js';
import type {startProfileSourceCapture} from './profile-source-capture.js';
import type {startRootNmpCustodyProcess} from './root-nmp-custody-process.js';
type Owner=Awaited<ReturnType<typeof startProfileSourceCapture>>;
export interface Entry {rootStock?:RoomTurnCustody;rootConsumer?:Function;rootCloseFailures?:unknown[];rootAttempt?:object;rootNmp?:Awaited<ReturnType<typeof startRootNmpCustodyProcess>>;rootNmpBytes?:Buffer;review:Readonly<ProfileSourceReview>;peer:Readonly<SourceCustodyPeer>;incarnation?:string;receipt?:Readonly<ProfileSourceApprovalReceipt>;state:'authorizing'|'approved'|'capturing'|'held'|'closing'|'consumed'|'unknown';controller:AbortController;owner?:Owner;token?:object;handle?:string;manifest?:Buffer;chargedBytes:number;metadataBytes:number;physical?:ReadonlyMap<string,string>;busy:boolean;observation?:{id:string;buffer:Buffer;hash:string};observationReservedBytes:number;endedObservationId?:string;closePromise?:Promise<void>}
