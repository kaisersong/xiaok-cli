import type {AssistantMessage} from '../../../shared/assistant-inbox-contract';
import type {ChatMessage} from '../components/ChatView';
/** Insert between entire task turns; never sort tool/result events independently. */
export function mergeAssistantMessages(chat:ChatMessage[],incoming:AssistantMessage[]):ChatMessage[]{
 const unique=new Map(incoming.map(m=>[m.id,m]));
 const notices=[...unique.values()].sort((a,b)=>a.createdAt-b.createdAt||a.id.localeCompare(b.id));
 const output:ChatMessage[]=[];let next=0;
 const append=(m:AssistantMessage)=>output.push({id:m.id,role:'assistant_message',content:m.text,createdAt:m.createdAt,assistantMessage:m});
 for(const message of chat){
  if(message.role==='user'&&typeof message.createdAt==='number')while(next<notices.length&&notices[next].createdAt<message.createdAt)append(notices[next++]);
  output.push(message);
 }
 while(next<notices.length)append(notices[next++]);
 return output;
}
