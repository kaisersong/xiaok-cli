// Synthetic transport only; the actual NativeService and SQLite journal run in this process.
import {DatabaseSync} from 'node:sqlite';
process.once('message',async({moduleUrl,dbPath,cwd,mode})=>{
 try{
  const {CodexNativeService}=await import(moduleUrl),actor={requestSource:'user',actorId:'journal-user'};
  const service=new CodexNativeService({dbPath,profileId:actor.actorId,createClient:options=>({
   threadId:'crash-thread',activeTurnId:null,async connect(){},async assertNoExternalTools(){},async create(){return {thread:{id:this.threadId}};},async close(){},async interrupt(){},
   async start(){
    if(mode==='intent'){process.send({phase:'intent',pid:process.pid,sessionId,wireSendId:'wire-crash'});return new Promise(()=>{});}
    options.onEvent({method:'turn/started',params:{threadId:'crash-thread',turnId:'turn-accepted',turn:{id:'turn-accepted'}}});
    const db=new DatabaseSync(dbPath);db.exec("CREATE TRIGGER reject_post_accept_display BEFORE INSERT ON codex_native_sessions WHEN EXISTS(SELECT 1 FROM codex_native_sends WHERE status='accepted') BEGIN SELECT RAISE(ABORT,'display write failed after accepted'); END");db.close();
    return {turnId:'turn-accepted'};
   }
  })});
  const sessionId=(await service.create(actor,cwd)).id;
  try{await service.send(actor,sessionId,'synthetic crash-point work','wire-crash');process.send({phase:'unexpected_success'});}
  catch(error){process.send({phase:'accepted-display-failed',pid:process.pid,sessionId,wireSendId:'wire-crash',error:error.message});}
 }catch(error){process.send({phase:'error',error:error.message});}
});
