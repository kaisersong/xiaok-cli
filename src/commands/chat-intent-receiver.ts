export type IntentReceiverCommand={kind:'status'|'help'|'cancel'}|{kind:'publish'|'recover'|'retry'|'project';candidateId:string};
export const intentReceiverHelp=`/intent receiver publish <候选ID>  原生批准并发布原已验证产物
/intent receiver recover <候选ID>  只收敛原发布请求，不重复原生批准
/intent receiver retry <候选ID>    原未批准请求封口后显式新尝试
/intent receiver project <候选ID>  重新完整验证后投影原阶段，下一阶段需显式继续
/intent receiver status            读取历史，不代表当前有效
/intent receiver cancel            请求中断并等待实际排空
父级未发布时，全部阶段完成仍不代表整个 Intent 完成。`;
export function parseIntentReceiverCommand(text:string):IntentReceiverCommand|null{
 const match=/^\/intent\s+receiver(?:\s+(.*))?$/u.exec(text.trim());if(!match)return null;const parts=(match[1]??'help').split(/\s+/u),kind=parts[0];
 if(['status','help','cancel'].includes(kind)&&parts.length===1)return {kind:kind as 'status'|'help'|'cancel'};
 if(['publish','recover','retry','project'].includes(kind)&&parts.length===2&&parts[1]&&Buffer.byteLength(parts[1])<=160&&!/[\x00-\x1f\x7f]/.test(parts[1]))return {kind:kind as 'publish'|'recover'|'retry'|'project',candidateId:parts[1]};
 throw Error('intent_receiver_command');
}
