// Cross-process harness: original production owners and real HTTP. Only thread
// and Room authorization are controlled; this is not a full Room admission test.
import {readFileSync} from 'node:fs';
import {ConversationActivityOwnerHost} from '../../../../src/runtime/conversation-activity/owner-host.js';
import {ConversationActivitySources} from '../../../../src/runtime/conversation-activity/sources.js';
import {ActivityProjectHttpTransport} from '../../../../src/runtime/conversation-activity/project-http-transport.js';
const config=JSON.parse(readFileSync(process.argv[2]!,'utf8')) as{dataRoot:string;profileId:string;workspaceId:string;epoch:string;url:string;token:string};
let sources:ConversationActivitySources,http:ActivityProjectHttpTransport,activityGets=0,closing:Promise<void>|undefined;
const send=(message:unknown)=>new Promise<void>((resolve,reject)=>{if(!process.send)return resolve();process.send(message,error=>error?reject(error):resolve());});
const host=new ConversationActivityOwnerHost({dataRoot:config.dataRoot,profileId:config.profileId,actorId:'user',getThread:threadId=>({threadId,profileId:config.profileId,workspaceId:config.workspaceId,deleteState:'none'}),canObserveWork:()=>true,authorizeProducer:()=>true,
 projectSource:{assertOwner(owner){if(owner!==sources)throw Error('foreign_source_owner');},ensureRound:p=>sources.ensureProjectRound(p),admitHint:p=>sources.admitProjectHint(p),read:(a,s,c)=>http.readProjectSource(a,s,c),assertRead:(a,f)=>http.assertProjectSourceRead(a,f as never),assertScoped:(a,f)=>http.assertScopedProjectRead(a,f as never)},onError:error=>{void send({type:'source_error',code:error instanceof Error?error.message:'unknown'});}});
http=new ActivityProjectHttpTransport({ownerEpoch:host.ownerEpoch,kswarm:{url:config.url,mutationToken:config.token,brokerUrl:config.url,roomToken:'unused'},onInvalidated:()=>host.invalidateProjectReads(),fetch:async(input,init)=>{if(new URL(String(input)).pathname==='/projects/p/activity')activityGets++;return fetch(input,init);}});
sources=new ConversationActivitySources({store:host.store,service:host.service,fixedProjectSource:true,taskHost:()=>{throw Error('unexpected_task');}});
host.store.prepareAssociation({operationId:'op',creationIdempotencyKey:'op',origin:{profileId:config.profileId,workspaceId:config.workspaceId,threadId:'thread',actorId:'user'}});
host.store.bindWork({operationId:'op',watchId:'watch',source:'kswarm',logicalSourceId:'kswarm',sourceDataEpoch:config.epoch,workId:'p'});
function close():Promise<void>{return closing??=(async()=>{await sources.close();await host.stop();await http.close();await send({type:'stopped',pid:process.pid,activityGets});})();}
process.on('message',(raw:unknown)=>{
 if(!raw||typeof raw!=='object')return;const message=raw as{type?:string;id?:string};
 if(message.type==='invalidate_http'){http.invalidate();void send({type:'invalidated',id:message.id});}
 if(message.type==='stats')void send({type:'stats',id:message.id,activityGets,pid:process.pid});
});
for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>{void close().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});});
process.once('disconnect',()=>{void close().then(()=>process.exit(0),()=>process.exit(1));});
await host.start();await send({type:'ready',ownerEpoch:host.ownerEpoch,pid:process.pid});
