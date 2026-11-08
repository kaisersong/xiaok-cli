import {KIM_WINDOW_SCHEMA,type KimWindow} from './contracts.js';
export function renderKimWindow(input:KimWindow):string {
 const w=KIM_WINDOW_SCHEMA.parse(input),time=w.target.sentAt;
 const context=(w.context??[]).filter(m=>time!==undefined&&m.sentAt!==undefined&&m.sentAt<time&&m.sentAt>=time-1800000&&(!w.target.id||m.id!==w.target.id)).sort((a,b)=>a.sentAt!-b.sentAt!).slice(-10);
 while(context.length&&context.reduce((n,m)=>n+m.text.length,0)+w.target.text.length>19000)context.shift();
 let sequence=0;const names=new Map<string,string>();const name=(sender:string)=>{const next=()=>`S${String(++sequence).padStart(4,'0')}`;if(!sender)return next();if(!names.has(sender))names.set(sender,next());return names.get(sender)!;};
 return [`群：${w.group.replace(/[\r\n]/g,' ')}`,'【前文窗口】',...(context.length?context.map(m=>`[${name(m.sender)}] ${m.text}`):['（无前文）']),'【目标消息】',`[${name(w.target.sender)}] ${w.target.text}`].join('\n');
}
