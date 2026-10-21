import {closeSync,constants,fstatSync,openSync,readSync} from 'node:fs';
import {captureIntentData} from '../runtime/intent-delegation/data.js';
import type {ValidationMaterialDraft} from '../runtime/verification/product-material-authorization.js';
export type IntentVerificationCommand={kind:'status'|'cancel'|'help'}|{kind:'reserve';path:string}|{kind:'enroll'|'run'|'recover';id:string};
export const intentVerificationHelp=`/intent verify reserve <JSON文件>  固定验证配置及请求身份
/intent verify enroll <记录ID>      原生登记真实验证调用
/intent verify run <记录ID>         原生材料授权后执行原独立验证
/intent verify recover <记录ID>     只恢复原请求，不重新执行
/intent verify status               读取历史事实（不是业务完成）
/intent verify cancel               请求中断当前操作，等待实际排空
JSON完整字段：candidateId、obligationId、exactCommand:{argv,cwdRelative}、materials:[{path,byteLimit}]、expiresAt（毫秒时间戳，至多24小时）。
材料path为用户明确选择的绝对路径；command来自用户原独立验证设置；不得把预期hash从产物反推。`;
export function parseIntentVerificationCommand(input:string):IntentVerificationCommand|null{
 const match=/^\/intent\s+verify(?:\s+(.*))?$/u.exec(input.trim());if(!match)return null;const text=match[1]??'help';
 if(['status','cancel','help'].includes(text))return {kind:text as 'status'|'cancel'|'help'};
 const action=/^(reserve|enroll|run|recover)\s+(.+)$/u.exec(text);if(!action)throw Error('intent_verification_command');const value=action[2].startsWith('"')?JSON.parse(action[2]):action[2];if(typeof value!=='string'||!value||/[\x00-\x1f\x7f]/.test(value)||(action[1]!=='reserve'&&Buffer.byteLength(value)>160))throw Error('intent_verification_command');return action[1]==='reserve'?{kind:'reserve',path:value}:{kind:action[1] as 'enroll'|'run'|'recover',id:value};
}
/** Capture the explicit file envelope. The existing Store draft parser validates
 * all material/command fields with the actual newly allocated invocation. No
 * synthetic invocation or native approval is created by this reader. */
export function readIntentVerificationSelectionFile(path:string):Readonly<{candidateId:string;obligationId:string;exactCommand:ValidationMaterialDraft['exactCommand'];materials:ValidationMaterialDraft['materials'];expiresAt:number}>{
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));try{
  const before=fstatSync(fd);if(!before.isFile()||before.size>65536)throw Error('intent_verification_file');const bytes=Buffer.alloc(65537);let size=0,count:number;do{count=readSync(fd,bytes,size,bytes.length-size,null);size+=count;}while(count&&size<bytes.length);const after=fstatSync(fd);if(size>65536||size!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)throw Error('intent_verification_file');
  const value=captureIntentData(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,size))));if(!value||typeof value!=='object'||Object.keys(value).sort().join(',')!=='candidateId,exactCommand,expiresAt,materials,obligationId'||[value.candidateId,value.obligationId].some(v=>typeof v!=='string'||!v||Buffer.byteLength(v)>160||/[\x00-\x1f\x7f]/.test(v)))throw Error('intent_verification_file');
  const freeze=(v:unknown):void=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}};freeze(value);return value;
 }finally{closeSync(fd);}
}
