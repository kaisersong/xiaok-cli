import {types} from 'node:util';
const ownerApply=Reflect.apply,ownerGet=WeakMap.prototype.get,ownerSet=WeakMap.prototype.set,ownerFreeze=Object.freeze,OwnerError=Error;
const OwnerPromise=Promise,ownerResolve=Promise.resolve,ownerThen=Promise.prototype.then,ownerIsProxy=types.isProxy,ownerIsPromise=types.isPromise,ownerMaxEpoch=Number.MAX_SAFE_INTEGER;
export interface OriginalDesktopApplicationWindowView {readonly window:unknown|null;readonly viewEpoch:number;assertLocal():void}
interface WindowOwnerState {read():Readonly<OriginalDesktopApplicationWindowView>}
const windowOwnerBirths=new WeakMap<object,WindowOwnerState>();
/** A passive view observation, never Native window or user authority. */
export function readOriginalDesktopApplicationWindowOwnerView(owner:unknown):Readonly<OriginalDesktopApplicationWindowView> {
  const state=ownerApply(ownerGet,windowOwnerBirths,[owner]) as WindowOwnerState|undefined;
  if(!state)throw new OwnerError('DESKTOP_APPLICATION_WINDOW_OWNER_REQUIRED');return state.read();
}

/** One app bootstrap, arbitrarily many views. Failed partial boot is never retried. */
export class DesktopApplicationWindowOwner<T> {
  private bootstrapResult: Promise<T> | undefined;
  private opening: Promise<T> | undefined;
  readonly #ports:{current():T|null;bootstrap():Promise<T>;createView():Promise<T>};
  constructor(ports: { current(): T | null; bootstrap(): Promise<T>; createView(): Promise<T> }) {
    const current=ports.current,bootstrap=ports.bootstrap,createView=ports.createView;
    let observed:unknown,viewEpoch=0,changing=false,failed:{error:unknown}|undefined;
    const advance=()=>{if(viewEpoch===ownerMaxEpoch)throw new OwnerError('DESKTOP_APPLICATION_WINDOW_EPOCH_EXHAUSTED');viewEpoch++;};
    const create=(fn:Function):Promise<T>=>{
      advance();changing=true;
      let raw:Promise<T>;try{raw=ownerApply(fn,ports,[]) as Promise<T>;}catch(error){changing=false;throw error;}
      const normalized=ownerApply(ownerResolve,OwnerPromise,[raw]) as Promise<T>;
      return ownerApply(ownerThen,normalized,[(value:T)=>{changing=false;return value;},(error:unknown)=>{changing=false;throw error;}]) as Promise<T>;
    };
    this.#ports=ownerFreeze({current:()=>ownerApply(current,ports,[]) as T|null,bootstrap:()=>create(bootstrap),createView:()=>create(createView)});
    ownerApply(ownerSet,windowOwnerBirths,[this,{read:()=>{
      if(failed)throw failed.error;
      try{
        const window=changing?null:this.#ports.current();
        if(window!==null&&(!window||typeof window!=='object'||ownerIsProxy(window)||ownerIsPromise(window)))throw new OwnerError('DESKTOP_APPLICATION_WINDOW_UNCONFIRMED',{cause:window});
        if(window!==observed){advance();observed=window;}
        const epoch=viewEpoch;
        return ownerFreeze({window,viewEpoch,assertLocal(){if(failed||changing||epoch!==viewEpoch||observed!==window)throw new OwnerError('DESKTOP_APPLICATION_WINDOW_VIEW_CHANGED');}});
      }catch(error){failed={error};throw error;}
    }}]);
  }

  open(): Promise<T> {
    // Startup can publish a BrowserWindow before its services are ready.
    if (this.opening) return this.opening;
    const initialize = this.bootstrapResult === undefined;
    const next = initialize
      ? Promise.resolve().then(() => this.#ports.bootstrap())
      : this.bootstrapResult!.then(() => this.#ports.current() ?? this.#ports.createView());
    if (initialize) this.bootstrapResult = next;
    this.opening = next;
    void next.finally(() => { if (this.opening === next) this.opening = undefined; }).catch(() => undefined);
    return next;
  }
}
