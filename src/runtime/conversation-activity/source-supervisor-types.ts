




import { type ChildProcess } from 'node:child_process';



import { createIntrinsicSet } from '../verification/intrinsic-async-collection.js';


import { createOwnedKSwarmPrefixV2Client, type KSwarmPrefixHelloAudience } from './owned-kswarm-control.js';



import { join } from 'node:path';

export type ConfigScope=Readonly<{profileId:string;workspaceId:string}>;
export interface ConfigRetirement {raw?:Promise<void>;completion:Promise<void>;complete():void;failure?:unknown;unknown:boolean}
export interface ConfigTarget {child:ChildProcess;generation:number;scope:ConfigScope;revoked:boolean;client?:ReturnType<typeof createOwnedKSwarmPrefixV2Client>;retirement?:ConfigRetirement}
export interface ConfigEndpointObserver {targetRevoked(target:ConfigTarget):void}
export interface ConfigSupervisor {ownerEpoch:string;generation:number;target?:ConfigTarget;retirements:ReturnType<typeof createIntrinsicSet<ConfigRetirement>>;endpoints:ReturnType<typeof createIntrinsicSet<ConfigEndpointObserver>>;isCurrent(target:ConfigTarget):boolean;configBound:boolean;business?:{revoke(target:ConfigTarget):void;join():Promise<unknown[]>}}
export interface CanonicalDesktopConfigEndpoint {sealAndDrain():Promise<void>}
export interface ConfigSend {completion:Promise<void>;complete():void;returned:boolean;callback:boolean;rawDone:boolean;rawUnknown:boolean;invoked:boolean;done:boolean;raw?:unknown;failure?:unknown}
export interface ConfigRoot {completion:Promise<void>;complete():void;raw?:unknown;workRaw?:unknown;send?:ConfigSend;failure?:unknown}
export interface ConfigOffer extends ConfigRoot {wire:Record<string,unknown>;audience?:KSwarmPrefixHelloAudience;nonce?:string;invocation?:ConfigRoot;challengeStarted:boolean}
export interface ActivityManagedSource {
  name: 'kswarm' | 'broker'; executable: string; entryPath: string; cwd: string;
  env: Record<string, string>; healthUrl: string; healthHeaders?: Record<string, string>;
  args?: string[]; expectedHealth: Record<string, string | number | boolean>;
}
export interface SourceReceipt { name: string; pid: number; birth: string; entryHash: string; ownerEpoch: string; external: boolean; instanceId?: string }
