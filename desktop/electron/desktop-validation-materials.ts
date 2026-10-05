import {app,dialog,type BrowserWindow} from 'electron';
import {selectExplicitValidationFiles} from '../../src/runtime/verification/material-selection.js';
import {authorizeProductValidationMaterials,type ValidationMaterialDraft,type ValidationMaterialAuthorizationClient,type AuthorizedProductValidationMaterials,type ValidationMaterialRequestJournal} from '../../src/runtime/verification/product-material-authorization.js';
/** Called only by the main-owned pending validation operation. Renderer does not
 * supply an invocation, paths, grant, approval Boolean or controller endpoint. */
export async function authorizeDesktopValidationMaterials(input:{
 requestSource:'user'|'agent'|'scheduler';window:BrowserWindow;cwd:string;
 operation:Omit<ValidationMaterialDraft,'materials'>;
 request?:ValidationMaterialRequestJournal;
 client:ValidationMaterialAuthorizationClient;assertCurrent():void;signal?:AbortSignal;
}):Promise<AuthorizedProductValidationMaterials|null>{
 if(input.requestSource!=='user')throw Error('validation_material_user_required');
 const window=input.window,cwd=input.cwd,originalClient=input.client,ownerCurrent=input.assertCurrent.bind(input),originalRequest=input.request;
 const client:ValidationMaterialAuthorizationClient=Object.freeze({prepareMaterialAuthorization:originalClient.prepareMaterialAuthorization.bind(originalClient),authorizeMaterialChallenge:originalClient.authorizeMaterialChallenge.bind(originalClient),prepareValidationInput:originalClient.prepareValidationInput.bind(originalClient),...(originalClient.prepareMaterialAuthorizationRequest?{prepareMaterialAuthorizationRequest:originalClient.prepareMaterialAuthorizationRequest.bind(originalClient)}:{})});
 let request:ValidationMaterialRequestJournal|undefined;
 if(originalRequest!==undefined){const descriptors=Object.getOwnPropertyDescriptors(originalRequest);if(Object.keys(descriptors).sort().join(',')!=='beforeStep,requestId'||Object.values(descriptors).some(d=>!('value' in d))||typeof descriptors.beforeStep.value!=='function'||typeof descriptors.requestId.value!=='string'||!descriptors.requestId.value||Buffer.byteLength(descriptors.requestId.value)>160||/[\x00-\x1f\x7f]/.test(descriptors.requestId.value))throw Error('validation_material_request_descriptor');request=Object.freeze({requestId:descriptors.requestId.value,beforeStep:descriptors.beforeStep.value.bind(originalRequest)});}
 const operation=structuredClone(input.operation),lifetime=new AbortController();
 const signal=input.signal?AbortSignal.any([input.signal,lifetime.signal]):lifetime.signal;
 const closed=()=>lifetime.abort(new DOMException('Window closed','AbortError'));
 const current=()=>{signal.throwIfAborted();if(window.isDestroyed())throw Error('validation_material_window_closed');const value:unknown=ownerCurrent();if(value!==undefined){void Promise.resolve(value).catch(()=>{});throw Error('validation_material_owner_guard_must_be_synchronous');}signal.throwIfAborted();};
 current();window.once('closed',closed);
 try{
  const zh=app.getLocale().startsWith('zh');
  const selection=await dialog.showOpenDialog(window,{title:zh?'选择本次验证需要读取的文件':'Select files this validation may read',properties:['openFile','multiSelections']});
  current();if(selection.canceled||!selection.filePaths.length)return null;
  const materials=selectExplicitValidationFiles(selection.filePaths,cwd);
  return await authorizeProductValidationMaterials({requestSource:'user',draft:{...operation,materials},client,request,signal,assertCurrent:current,
   async review(value){
    current();const detail=[...value.materials.map(item=>`${item.path}\n${item.size} bytes · SHA-256 ${item.sha256}`),'',`${zh?'验证命令':'Validation command'}: ${value.exactCommand.argv.map(arg=>JSON.stringify(arg)).join(' ')}`,`${zh?'工作目录':'Working directory'}: ${value.exactCommand.cwdRelative}`,`${zh?'有效期至':'Expires'}: ${new Date(value.expiresAt).toISOString()}`].join('\n');
    const answer=await dialog.showMessageBox(window,{type:'info',title:zh?'确认验证材料':'Review validation materials',message:zh?'系统授权后，隔离验证将读取以下文件并执行所列命令。':'After system authorization, isolated validation will read these files and execute this command.',detail,buttons:zh?['取消','继续前往系统授权']:['Cancel','Continue to system authorization'],defaultId:0,cancelId:0});
    current();if(answer.response!==1)throw cancelled;
   }});
 }catch(error){if(error===cancelled)return null;throw error;}
 finally{window.removeListener('closed',closed);}
}
const cancelled=Symbol('validation_material_review_cancelled');
