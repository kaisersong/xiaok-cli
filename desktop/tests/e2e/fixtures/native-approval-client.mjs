import {appendFileSync} from 'node:fs';
import {join} from 'node:path';

/** Only the external Native transport is controlled; all Main owners stay real. */
export function createNativeApprovalFixture(root){
  let creates=0,release;const ready=new Promise(resolve=>{release=resolve;});
  const factory=options=>{
    const record=value=>appendFileSync(join(root,'native-client.jsonl'),JSON.stringify(value)+'\n');
    record({type:'client-created',count:++creates});
    return new class{
      threadId='fixture-native-thread';activeTurnId=null;pid=0;exited=false;
      async connect(){}async create(){return{thread:{id:this.threadId}};}async resume(id){this.threadId=id;}
      emit(method,params){options.onEvent({method,params:{threadId:this.threadId,turnId:this.activeTurnId,...params}});}
      async start(){
        this.activeTurnId='fixture-native-turn';this.emit('turn/started',{turn:{id:this.activeTurnId,status:'inProgress'}});record({type:'turn-started'});
        void ready.then(()=>{
          const pending=['native-read-first','native-read-second'].map((command,index)=>options.onApproval({id:index+1,method:'item/commandExecution/requestApproval',params:{threadId:this.threadId,turnId:this.activeTurnId,command}}).then(result=>{record({type:'decision',command,result});return result;}));
          void Promise.all(pending).then(()=>{if(this.exited||!this.activeTurnId)return;this.emit('item/agentMessage/delta',{itemId:'answer',delta:'Native approval fixture finished.'});this.emit('turn/completed',{turn:{id:this.activeTurnId,status:'completed'}});this.activeTurnId=null;},error=>record({type:'fixture-error',message:String(error)}));
        });
        return{turnId:this.activeTurnId};
      }
      async steer(){return{turnId:this.activeTurnId};}
      async interrupt(){if(this.activeTurnId)this.emit('turn/completed',{turn:{id:this.activeTurnId,status:'interrupted'}});this.activeTurnId=null;}
      async close(){this.exited=true;record({type:'client-closed'});}
    }();
  };
  factory.releaseApprovals=()=>release();return factory;
}
