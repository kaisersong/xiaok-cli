


import type { DesktopPreparationCompositionLaunch } from './default-dispatch-preparation-composition-bootstrap.js';
import { createOwnedCanonicalBusiness, type CanonicalPreparationFacet, type CanonicalBusinessAdmission } from '../../src/runtime/conversation-activity/owned-canonical-business.js';
import type { DesktopDispatchLaunch } from './default-dispatch-native-bootstrap.js';
import { type ChildProcess } from 'node:child_process';





import { type KSwarmOwnedBusinessTransport, type KSwarmService } from './kswarm-service.js';
import { type KSwarmWriterControlSource } from './kswarm-writer-control-source.js';

import type { KSwarmOwnedControlContext } from './kswarm-owned-control.js';


import { ConversationActivityOwnerClient } from '../../src/runtime/conversation-activity/owner-client.js';


import { createIntrinsicSet } from '../../src/runtime/verification/intrinsic-async-collection.js';

export type Scope=Readonly<{profileId:string;workspaceId:string}>;
export type Operation='inspect_writer'|'prepare_initial_plan_writer';
export interface Status {profileId:string;generation?:number;configDigest?:string;ready?:boolean;pid?:number;ownerEpoch?:string;nativeSourceProtocol?:number}
export interface LaunchSdkTail {raw:Promise<unknown>;completed:boolean;listeners:Array<()=>void>}
export interface PreparationLaunchState {owner:object;capsule:object;composition?:Readonly<DesktopPreparationCompositionLaunch>;port?:CanonicalPreparationFacet;failure?:{error:unknown}}
export interface LaunchState {dispatchClient?:ReturnType<typeof createOwnedCanonicalBusiness>;preparation?:PreparationLaunchState;source:KSwarmWriterControlSource;service:KSwarmService;capsule:object;scope:Scope;digest?:string;promise:Promise<ConversationActivityOwnerClient>;workRaw?:Promise<void>;observationUnknown?:boolean;spawnFailure?:unknown;retainedInitialization:ReturnType<typeof createIntrinsicSet<unknown>>;workDone:Promise<void>;workCompleted:boolean;initializationListeners:Array<()=>void>;complete():void;closed:boolean;failure?:unknown;relay?:Relay;child?:ChildProcess;configArtifact?:string;closing?:Promise<void>;sdkFailure?:unknown;sdkErrors:unknown[];sdkTails:ReturnType<typeof createIntrinsicSet<LaunchSdkTail>>;retirementSdkTail?:((tail:LaunchSdkTail)=>void);business?:{controller:object;capsule:object;launch?:DesktopDispatchLaunch;port?:KSwarmOwnedBusinessTransport;admission?:CanonicalBusinessAdmission;initialized:boolean}}
export interface Relay {readonly installed:boolean;call(op:Operation,context:KSwarmOwnedControlContext):Promise<unknown>;seal():void;drain():Promise<void>;observeClose(done:(error?:unknown)=>void):void;retirement():Readonly<{revision:number;known:boolean}>}
export interface BusinessBootstrap {controller:object;capsule:object}
export interface PreparationBootstrap {owner:object;capsule:object}
export interface LaunchOptions {source:KSwarmWriterControlSource;service:KSwarmService;capsule:object;businessBootstrap?:BusinessBootstrap;preparationBootstrap?:PreparationBootstrap}
