import type {createEngineBootstrapJournal,EngineBootstrapProposal,EngineBootstrapObservation} from './engine-bootstrap-journal.js';
import {canonicalVerificationJson} from './protocol.js';
/** Service-private order coordinator. These ports are NOT a qualification issuer;
 * installed composition supplies fixed executables and real kernel/guest census. */
export async function bootstrapPrivateEngine(input:{journal:ReturnType<typeof createEngineBootstrapJournal>;proposal:EngineBootstrapProposal;ports:{assertCurrent():void;create(signal?:AbortSignal):Promise<void>;initialize(signal?:AbortSignal):Promise<void>;observe(signal?:AbortSignal):Promise<EngineBootstrapObservation>};signal?:AbortSignal}):Promise<Readonly<EngineBootstrapObservation>>{
 const {journal,signal}=input,proposal=Object.freeze(JSON.parse(canonicalVerificationJson(input.proposal))) as EngineBootstrapProposal;
 const assertCurrent=input.ports.assertCurrent.bind(input.ports),create=input.ports.create.bind(input.ports),initialize=input.ports.initialize.bind(input.ports),observe=input.ports.observe.bind(input.ports);
 function current(){signal?.throwIfAborted();const result:unknown=assertCurrent();if(result!==undefined){void Promise.resolve(result).catch(()=>{});throw Error('engine_bootstrap_sync');}}
 current();journal.prepare(proposal);const state=journal.read();
 if(state?.state==='prepared'){
  current();journal.beginCreate(proposal);
  // There is no asynchronous gap between durable intent and calling the exact
  // fixed creator. Lost responses always leave a non-replayable state.
  await create(signal);current();await initialize(signal);current();
 }
 const observation=await observe(signal);current();journal.recordObservation(proposal,observation);
 return Object.freeze(JSON.parse(canonicalVerificationJson(observation))) as Readonly<EngineBootstrapObservation>;
}

/** Explicit service-private repair of exact fixed phases. apply must be an
 * idempotent, conflict-refusing installed operation, never an arbitrary script.
 * No VM create/start port is present, and no observation mints qualification. */
export async function recoverPrivateEngine(input:{journal:ReturnType<typeof createEngineBootstrapJournal>;proposal:EngineBootstrapProposal;ports:{assertCurrent():void;observeVm(signal?:AbortSignal):Promise<import('./engine-bootstrap-journal.js').EngineVmObservation>;phases:readonly {name:import('./engine-bootstrap-journal.js').EngineBootstrapPhase;digest:string;apply(signal?:AbortSignal):Promise<void>;isComplete(signal?:AbortSignal):Promise<boolean>}[];observe(signal?:AbortSignal):Promise<EngineBootstrapObservation>};signal?:AbortSignal}):Promise<Readonly<EngineBootstrapObservation>>{
 const {journal,signal}=input,proposal=Object.freeze(JSON.parse(canonicalVerificationJson(input.proposal))) as EngineBootstrapProposal;
 const p=input.ports,assertCurrent=p.assertCurrent.bind(p),observeVm=p.observeVm.bind(p),observe=p.observe.bind(p);
 const phases=p.phases.map(x=>Object.freeze({name:x.name,digest:x.digest,apply:x.apply.bind(x),isComplete:x.isComplete.bind(x)}));
 if(phases.map(x=>x.name).join(',')!=='copy-engine,install-engine,load-worker'||phases.some(x=>!/^[a-f0-9]{64}$/.test(x.digest)))throw Error('engine_phase_shape');
 function current(){signal?.throwIfAborted();const r:unknown=assertCurrent();if(r!==undefined){void Promise.resolve(r).catch(()=>{});throw Error('engine_bootstrap_sync');}}
 async function census(){current();const vm=await observeVm(signal);current();journal.recordVm(proposal,vm);}
 await census();
 for(const phase of phases){
  current();journal.phase(proposal,phase.name,phase.digest);
  const completed=await phase.isComplete(signal);current();if(typeof completed!=='boolean')throw Error('engine_phase_observation');
  if(!completed){if(journal.read()?.phases?.[phase.name]?.state==='complete')throw Error('engine_phase_drift');await census();await phase.apply(signal);current();}
  await census();const confirmed=await phase.isComplete(signal);current();if(confirmed!==true)throw Error('engine_phase_not_complete');
  journal.phase(proposal,phase.name,phase.digest,true);
 }
 const observation=await observe(signal);current();await census();journal.recordObservation(proposal,observation);
 return Object.freeze(JSON.parse(canonicalVerificationJson(observation))) as Readonly<EngineBootstrapObservation>;
}
