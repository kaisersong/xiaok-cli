// UNREVIEWED CANDIDATE: requires rollout round 36 addition in ipc-runtime.ts.
import { z } from 'zod';
import { registerIpcHandler, type RiskTag } from './ipc-runtime.js';
import type { IpcHandleRegistrar, IpcHandlerListener } from './shutdown-aware-ipc-main.js';
import { MATERIAL_ACCESS_METHODS, MATERIAL_ACCESS_OUTPUTS, type MaterialAccessMethod } from './material-access-ipc-contract.js';
import { assertMaterialAccessEnvironment, captureMaterialAccessInput, captureMaterialAccessOutput, captureMaterialAccessValue, materialAccessError } from './material-access-data.js';
const owners = new WeakMap<IpcHandleRegistrar,{original:ReadonlyMap<string,IpcHandlerListener>; bindings:ReadonlyMap<string,IpcHandlerListener>; installed:Set<MaterialAccessMethod>}>();
const risks: Record<MaterialAccessMethod,RiskTag[]> = {
  readClipboardImage:['clipboard','fs-write'], selectDirectory:['dialog'], selectMaterials:['dialog','fs-read'],
  importMaterial:['fs-read','fs-write-userData'], openArtifact:[], selectHtmlEditMedia:['dialog','fs-read'],
};
export function registerMaterialAccessIpc(ipc:IpcHandleRegistrar, producers:ReadonlyMap<string,IpcHandlerListener>):void {
  let owner=owners.get(ipc);
  if(owner && owner.original!==producers) throw Error('material_access_registrar_owner_conflict');
  if(!owner){owner={original:producers,bindings:new Map(producers),installed:new Set()};owners.set(ipc,owner);}
  const bindings=owner.bindings;
  for(const method of MATERIAL_ACCESS_METHODS){
    if(owner.installed.has(method))continue;
    registerIpcHandler<unknown[],unknown>({registrar:ipc,channel:'desktop:'+method,payloadMode:'tuple',rolloutRound:36,
      sourceFile:'desktop/electron/material-access-typed-ipc.ts',riskTags:risks[method],
      input:z.custom<unknown[]>(()=>true).transform(raw=>captureMaterialAccessInput(method,raw)),output:MATERIAL_ACCESS_OUTPUTS[method],
      handler:async(args,event)=>{
        try{
          assertMaterialAccessEnvironment();
          const producer=bindings.get('desktop:'+method);if(!producer)throw Error('material_access_runtime_unavailable');
          return await captureMaterialAccessValue(producer(event,...args),raw=>captureMaterialAccessOutput(method,raw));
        }catch(error){throw Error(materialAccessError(error));}
      },
    });
    owner.installed.add(method);
  }
}
