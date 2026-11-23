import {randomBytes} from 'node:crypto';
import {captureOwnedConfigurationData} from '../../src/runtime/conversation-activity/owned-kswarm-control.js';
import type {Scope} from './activity-owner-writer-launcher-types.js';
const setPrototype=Object.setPrototypeOf,descriptors=Object.getOwnPropertyDescriptors,ownKeys=Reflect.ownKeys,own=Object.hasOwn;
export function hex(value:unknown):value is string{return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);}
export function nonce(){const bytes=randomBytes(32);let result='';const digits='0123456789abcdef';for(let i=0;i<bytes.length;i++)result+=digits[bytes[i]!>>>4]!+digits[bytes[i]!&15]!;return result;}
export function same(a:Scope,b:Scope){return a.profileId===b.profileId&&a.workspaceId===b.workspaceId;}
export function inert(raw:unknown):unknown{if(!raw||typeof raw!=='object')return raw;setPrototype(raw,null);const rows=descriptors(raw),keys=ownKeys(rows);for(let i=0;i<keys.length;i++){const key=keys[i]!;if(typeof key==='string'&&key!=='length'&&own(rows[key]!,'value'))inert(rows[key]!.value);}return raw;}
export function data(raw:unknown){return inert(captureOwnedConfigurationData(raw)) as Record<string,unknown>;}
export function exact(row:Record<string,unknown>,keys:readonly string[]){const names=ownKeys(row);if(names.length!==keys.length)throw Error('WRITER_CONFIG_PROTOCOL_INVALID');for(let i=0;i<keys.length;i++)if(!own(row,keys[i]!))throw Error('WRITER_CONFIG_PROTOCOL_INVALID');}
