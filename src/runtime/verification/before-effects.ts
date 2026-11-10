import {types} from 'node:util';

const nativeThen=Promise.prototype.then;

/** Only narrows an existing owner's admission. It never grants permission. */
export function assertBeforeEffects(beforeEffects:(()=>void)|undefined):void {
  if(beforeEffects===undefined)return;
  if(typeof beforeEffects!=='function')throw Error('before_effects_guard_invalid');
  const returned:unknown=beforeEffects();
  if(returned===undefined)return;
  // Reject async guards without assimilating a foreign thenable. Observe an
  // actual rejected Promise so invalid trusted composition cannot orphan it.
  if(types.isPromise(returned)){
    try{void Reflect.apply(nativeThen,returned,[()=>{},()=>{}]);}catch{}
  }
  throw Error('before_effects_guard_invalid');
}
