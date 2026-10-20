import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { canonical,hash,parseCanonical } from './crypto.mjs';
import { validateCoordinatorIdentity } from './identity.mjs';
import { privateDirectory,privateFile,syncDirectory } from './private-files.mjs';

function unavailable(){return new Error('provisioning_unavailable');}
function contains(parent,child){const relative=path.relative(parent,child);return relative===''||!path.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+path.sep);}

/** Trusted deployment boundary. The test override is authorized by the root-signed certificate,
 * never by NODE_ENV/HOME or an unsigned config field. A consumed identity is never reinitialized. */
export function claimCoordinatorProvisioning({identity,stateDir,witnessDir,initialize=false,testProvisioningDir}){
  const {identity:verified}=validateCoordinatorIdentity(identity),mode=verified.certificate.body.deploymentMode;
  if(mode==='self-hosted'&&testProvisioningDir!==undefined)throw new Error('test_provisioning_forbidden');
  if(mode==='test'&&(typeof testProvisioningDir!=='string'||!testProvisioningDir))throw new Error('test_provisioning_required');
  if(process.platform==='win32'||typeof process.getuid!=='function')throw new Error('private_storage_platform_unavailable');
  try{
    const state=privateDirectory(stateDir),witness=privateDirectory(witnessDir);
    if(contains(state,witness)||contains(witness,state))throw unavailable();
    if(initialize&&(fs.readdirSync(state).length||fs.readdirSync(witness).length))throw unavailable();
    // userInfo asks the OS account database; HOME cannot relocate a production registry.
    const registryPath=mode==='test'?testProvisioningDir:path.join(os.userInfo().homedir,'.xiaok-context-sync-provisioning-v1');
    const registry=privateDirectory(registryPath);
    if([state,witness].some(dir=>contains(dir,registry)||contains(registry,dir)))throw unavailable();
    const key=hash(['xiaok/context-sync/provisioning-key/v1',verified.rootKeyId,verified.syncGroupId,verified.coordinatorId]);
    const filename=path.join(registry,key+'.json'),record={schemaVersion:1,identityHash:hash(verified),stateDir:state,witnessDir:witness};
    if(initialize){
      // O_EXCL consumes this identity before any journal can be initialized. Failure is sticky:
      // operators recover the original files, or root-provision a new coordinatorId.
      const fd=fs.openSync(filename,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeFileSync(fd,canonical(record));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(registry);
    }else{
      privateFile(filename);if(fs.statSync(filename).size>16*1024)throw unavailable();
      if(canonical(parseCanonical(fs.readFileSync(filename)))!==canonical(record))throw unavailable();
    }
    return Object.freeze(record);
  }catch(e){throw new Error('provisioning_unavailable',{cause:e});}
}
