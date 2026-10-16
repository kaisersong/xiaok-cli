import {captureIntentData} from './data.js';
import type {PersistedSessionSnapshot} from '../../ai/runtime/session-store/store.js';
import type {StoredSessionSnapshot} from '../../ai/runtime/session-store/stored-snapshot-types.js';
export function captureIntentSnapshot(snapshot:PersistedSessionSnapshot):PersistedSessionSnapshot;
export function captureIntentSnapshot(snapshot:StoredSessionSnapshot):StoredSessionSnapshot;
export function captureIntentSnapshot(snapshot:StoredSessionSnapshot):StoredSessionSnapshot {
 const descriptor=Object.getOwnPropertyDescriptor(snapshot,'intentDelegation');
 if(descriptor&&!('value'in descriptor))throw Error('intent_commit_accessor');
 return {...snapshot,intentDelegation:descriptor?.value===undefined?undefined:captureIntentData(descriptor.value)};
}