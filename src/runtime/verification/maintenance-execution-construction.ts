import type {InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {assertInstalledControllerLifetime} from './installed-controller-lifetime.js';
import {assertDockerRunnerDatabase,type createDockerRunner} from '../isolated-execution/docker-runner.js';
import {ExecutionJournal} from '../isolated-execution/execution-journal.js';

// Resource bookkeeping only: no ticket issuance, component binding, activation,
// transport operation, deletion, callback or resource getter is exposed here.
const retained=new Set<MaintenanceExecutionConstruction>();
const unresolved=new WeakMap<object,{construction:object|undefined;owner:MaintenanceExecutionConstruction}>();
export function hasUnresolvedMaintenanceExecutionConstruction(error:unknown,construction:object):boolean{return typeof error==='object'&&error!==null&&unresolved.get(error)?.construction===construction;}
export class MaintenanceExecutionConstruction {
 private raw:ReturnType<typeof createDockerRunner>|undefined;
 private journal:ExecutionJournal|undefined;
 private primary:unknown;
 private cleanupErrors:unknown[]=[];
 private phase:'constructing'|'committed'|'disposed'|'failed-unknown'='constructing';
 constructor(private readonly lifetime:InstalledControllerLifetime,private readonly construction:object|undefined){assertInstalledControllerLifetime(lifetime);retained.add(this);}
 holdRaw(raw:ReturnType<typeof createDockerRunner>):void{
  if(this.phase!=='constructing'||this.raw)throw Error('maintenance_execution_construction');
  // Store before a current/identity check can itself fail. The sole production
  // caller passes the actual fixed factory return, never a request-provided port.
  this.raw=raw;assertDockerRunnerDatabase(raw,this.lifetime.database);
 }
 openJournal():ExecutionJournal{
  if(this.phase!=='constructing'||!this.raw||this.journal)throw Error('maintenance_execution_construction');
  const journal=new ExecutionJournal({database:this.lifetime.database});this.journal=journal;return journal;
 }
 commit():void{if(this.phase!=='constructing'||!this.raw||!this.journal)throw Error('maintenance_execution_construction');this.phase='committed';retained.delete(this);}
 dispose():void{
  if(this.phase==='failed-unknown')throw this.failure('maintenance_execution_disposal_unknown');
  if(this.phase==='disposed')return;
  const errors:unknown[]=[];for(const close of [()=>this.journal?.close(),()=>this.raw?.close()])try{close();}catch(error){errors.push(error);}
  if(errors.length){this.cleanupErrors=errors;this.phase='failed-unknown';retained.add(this);throw this.failure('maintenance_execution_disposal_unknown');}
  this.phase='disposed';retained.delete(this);
 }
 fail(primary:unknown):unknown{
  this.primary=primary;
  try{this.dispose();}catch(cleanup){const failure=new AggregateError([primary,cleanup],'maintenance_execution_partial_construction_unknown',{cause:primary});unresolved.set(failure,{construction:this.construction,owner:this});retained.add(this);return failure;}
  return primary;
 }
 private failure(message:string):AggregateError{const error=new AggregateError([...this.cleanupErrors],message,{cause:this.primary});unresolved.set(error,{construction:this.construction,owner:this});return error;}
}
