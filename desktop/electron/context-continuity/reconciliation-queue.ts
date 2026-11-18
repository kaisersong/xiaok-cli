import type {TaskSnapshot} from '../../shared/task-types.js';

export type ReconciliationReader=(taskId:string)=>Promise<TaskSnapshot|null>;
interface Queue {waiting:Array<{resolve():void;reject(raw:unknown):void}>;}

/** Each batch starts after all its callers arrived; completed scans are never cached. */
export class ContinuityReconciliationQueue {
  readonly #queues=new Map<ReconciliationReader,Queue>();
  readonly #pending:Set<Promise<unknown>>;
  readonly #closed:()=>boolean;
  readonly #pass:(inspect:ReconciliationReader)=>Promise<void>;
  constructor(pending:Set<Promise<unknown>>,closed:()=>boolean,pass:(inspect:ReconciliationReader)=>Promise<void>){
    this.#pending=pending;this.#closed=closed;this.#pass=pass;
  }
  async reconcile(inspect:ReconciliationReader):Promise<void>{
    if(this.#closed())return;
    let queue=this.#queues.get(inspect);
    const start=!queue;
    if(!queue){queue={waiting:[]};this.#queues.set(inspect,queue);}
    let resolve!:()=>void,reject!:(raw:unknown)=>void;
    const request=new Promise<void>((yes,no)=>{resolve=yes;reject=no;});
    this.#pending.add(request);
    queue.waiting.push({resolve,reject});
    if(start){
      const current=queue;
      const worker=Promise.resolve().then(()=>this.#drain(inspect,current));
      this.#pending.add(worker);
      void worker.then(()=>this.#pending.delete(worker),()=>this.#pending.delete(worker));
    }
    try{await request;}finally{this.#pending.delete(request);}
  }
  async #drain(inspect:ReconciliationReader,queue:Queue):Promise<void>{
    try{
      while(queue.waiting.length){
        // No await between taking this batch and starting its original scan.
        // Later callers stay queued for a new pass, never an already-started one.
        const batch=queue.waiting.splice(0);
        try{
          if(!this.#closed())await this.#pass(inspect);
          for(const request of batch)request.resolve();
        }catch(raw){for(const request of batch)request.reject(raw);}
      }
    }finally{if(this.#queues.get(inspect)===queue)this.#queues.delete(inspect);}
  }
}
