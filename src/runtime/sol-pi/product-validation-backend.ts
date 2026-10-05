import {isDeepStrictEqual} from 'node:util';
import {realpathSync} from 'node:fs';
import {relative,resolve,isAbsolute,sep} from 'node:path';
import type {CompoundValidationBackend} from './compound-validation.js';
import type {IsolatedExecutionPort,HostIssuedMountPlan} from '../isolated-execution/execution-port.js';
import {consumeProductValidationMaterials,type ValidationMaterialDraft,type ValidationMaterialAuthorizationClient,type AuthorizedProductValidationMaterials,type PreparedValidationMaterials,type ValidationMaterialInvocation} from '../verification/product-material-authorization.js';
export interface InstalledProductVerificationClient {
 materialAuthorization:ValidationMaterialAuthorizationClient;execution:IsolatedExecutionPort;
 wrapPreparedValidationInput(prepared:PreparedValidationMaterials):HostIssuedMountPlan;
}
/** Wiring only: obtain client from the fixed installed controller factory and
 * probe actual qualification before enabling the registry. No qualification is minted here. */
export function createProductValidationBackend(options:{
 workspaceRoot:string;expiresAt:number;client:InstalledProductVerificationClient;assertCurrent():void;
 authorize(input:{workspaceRoot:string;operation:Omit<ValidationMaterialDraft,'materials'>;client:ValidationMaterialAuthorizationClient;signal?:AbortSignal;assertCurrent():void}):Promise<AuthorizedProductValidationMaterials|null>;
}):CompoundValidationBackend{
 const root=realpathSync(options.workspaceRoot),{client,expiresAt}=options;
 async function prepare(request:{purpose:ValidationMaterialDraft['purpose'];invocation:ValidationMaterialInvocation;command:{command:string;workdir:string};editedFile?:ValidationMaterialDraft['editedFile']},signal?:AbortSignal){
  options.assertCurrent();signal?.throwIfAborted();const snapshot=structuredClone(request);
  const cwd=realpathSync(resolve(root,snapshot.command.workdir)),rel=relative(root,cwd);
  if(isAbsolute(rel)||rel==='..'||rel.startsWith('..'+sep))throw Error('validation_material_command_outside_workspace');
  const operationExpiresAt=Math.min(expiresAt,Date.now()+15*60*1000),command={argv:['/bin/sh','-c',snapshot.command.command],cwdRelative:rel.split(sep).join('/')||'.'};
  const authorized=await options.authorize({workspaceRoot:root,operation:{purpose:snapshot.purpose,invocation:snapshot.invocation,exactCommand:command,...(snapshot.editedFile?{editedFile:snapshot.editedFile}:{}),expiresAt:operationExpiresAt},client:client.materialAuthorization,signal,assertCurrent:options.assertCurrent});
  options.assertCurrent();signal?.throwIfAborted();if(!authorized)throw Error('validation_material_user_cancelled');
  const prepared=consumeProductValidationMaterials(authorized,{purpose:snapshot.purpose,invocation:snapshot.invocation,exactCommand:command,...(snapshot.editedFile?{editedFile:snapshot.editedFile}:{})});
  if(Date.now()>=operationExpiresAt||!isDeepStrictEqual(prepared.invocation,snapshot.invocation)||!isDeepStrictEqual(prepared.command,command))throw Error('validation_material_authorization_mismatch');
  const materializedInput=client.wrapPreparedValidationInput(prepared);return{materializedInput,command:prepared.command,scopeDigest:prepared.scopeDigest};
 }
 return Object.freeze({execution:client.execution,
  prepareValidationInput(input:Parameters<CompoundValidationBackend['prepareValidationInput']>[0]){
   return prepare({purpose:'isolated-validation',invocation:{sessionIdentity:input.sessionIdentity,compoundOperationId:input.compoundOperationId,validationInvocationId:input.validationInvocationId},editedFile:{path:input.editedFile.path,afterHash:input.editedFile.afterHash},command:input.command},input.signal);
  },
  prepareDirectInput(input:Parameters<NonNullable<CompoundValidationBackend['prepareDirectInput']>>[0]){
   return prepare({purpose:'isolated-command',invocation:{sessionIdentity:input.sessionIdentity,compoundOperationId:input.operationId,validationInvocationId:input.validationInvocationId},command:input.command},input.signal);
  },
 });
}
