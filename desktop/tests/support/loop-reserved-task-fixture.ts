import type {UserLoopTaskPort} from '../../electron/user-loop-template-runner.js';
/** Ordinary runner unit fixtures: task execution remains their existing explicit leaf mock.
 * Actual identity ordering is exercised separately with the real TaskRuntimeHost. */
export function withReservedTaskFixture<T extends UserLoopTaskPort>(port:T,taskId:string):T {
 const pending=new WeakMap<object,Parameters<T['createTask']>[0]>();
 return Object.assign(port,{reserveTask(input:Parameters<T['createTask']>[0]){const control={};pending.set(control,structuredClone(input));return {taskId,control};},async createReservedTask(control:object){const input=pending.get(control);pending.delete(control);if(!input)throw Error('fixture_identity');return port.createTask(input);},discardReservedTask(control:object){pending.delete(control);}});
}
