import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,createPrivateKey,createPublicKey} from 'node:crypto';
import {parseInstalledDeploymentManifest} from './deployment-manifest.js';
import {parseCompositeServicePair,type CompositeServiceRegistration} from './composite-service-registration.js';
import {parseInstalledReceiverRegistration} from './installed-receiver-registration.js';
import {assertRootProtectedFile,assertRootProtectedExecutable,assertInstalledControllerIdentity} from './installed-identity.js';
import {parseDeploymentPackageInventory,verifyDeploymentPackage} from './deployment-package.js';
import {acquireControllerLifetimeLock} from './controller-lifetime-lock.js';
const instances=new WeakMap<object,()=>void>();
export function assertInstalledCompositeLifetime(value:object){const current=instances.get(value);if(!current)throw Error('composite_lifetime_identity');current();}
/** Independent fixed service identity. It cannot reuse controller keys, UID or
 * state; store closure/drain must complete before releasing this lifetime lock. */
export function createInstalledCompositeLifetime(kind:CompositeServiceRegistration['kind']){
 if(arguments.length!==1||!['egress','participant'].includes(kind))throw Error('composite_lifetime_arguments');
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('composite_lifetime_platform');
 const base='/Library/Application Support/xiaok-verification',state=join(base,kind+'-state');
 function protectedBytes(path:string,limit:number){assertRootProtectedFile(path);if(lstatSync(path).size>limit)throw Error('composite_lifetime_file_limit');return readFileSync(path);}
 const deploymentPath=join(base,'deployment.json'),registrationPath=join(base,kind+'.json'),deploymentBytes=protectedBytes(deploymentPath,65536),registrationBytes=protectedBytes(registrationPath,65536),manifest=parseInstalledDeploymentManifest(JSON.parse(deploymentBytes.toString('utf8')));
 const receiver=parseInstalledReceiverRegistration(JSON.parse(protectedBytes(join(base,'receiver.json'),65536).toString('utf8')),{controllerPublicKey:createPublicKey(manifest.publicKeyPem),controllerServiceUid:manifest.serviceUid,interactiveUids:manifest.allowedUserIds});
 const egressBytes=protectedBytes(join(base,'egress.json'),65536),participantBytes=protectedBytes(join(base,'participant.json'),65536);
 const pair=parseCompositeServicePair(JSON.parse(egressBytes.toString('utf8')),JSON.parse(participantBytes.toString('utf8')),{packageHash:manifest.packageHash,controllerAuthorityId:manifest.authorityId,forbiddenUids:[manifest.serviceUid,receiver.serviceUid,...manifest.allowedUserIds],forbiddenPublicKeys:[manifest.publicKeyPem,receiver.publicKeyPem]});
 const definition=pair[kind],release=join(base,'releases',manifest.packageHash),executable=join(release,'bin/node');
 function checkIdentity(){assertInstalledControllerIdentity({serviceUid:definition.serviceUid,interactiveUids:[...manifest.allowedUserIds,manifest.serviceUid],executable,stateRoot:state});}
 checkIdentity();const inventory=parseDeploymentPackageInventory(JSON.parse(protectedBytes(join(base,'releases',manifest.packageHash+'.json'),8*1024**2).toString('utf8')));
 if(inventory.packageHash!==manifest.packageHash)throw Error('composite_lifetime_package');verifyDeploymentPackage(release,inventory);
 const entry=join(release,'app/'+kind+'.cjs'),peerHelper=join(release,'bin/socket-audit-peer');assertRootProtectedFile(entry);assertRootProtectedExecutable(peerHelper);
 const lock=acquireControllerLifetimeLock(state);
 try{
  const keyPath=join(state,'authority-key.pem'),initial=lstatSync(keyPath);
  function keyBytes(){const s=lstatSync(keyPath);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1||s.uid!==definition.serviceUid||(s.mode&0o777)!==0o600||s.size>8192||s.dev!==initial.dev||s.ino!==initial.ino)throw Error('composite_lifetime_key');return readFileSync(keyPath);}
  const raw=keyBytes();let privateKey:ReturnType<typeof createPrivateKey>,keyHash:string;
  try{privateKey=createPrivateKey(raw);keyHash=createHash('sha256').update(raw).digest('hex');}finally{raw.fill(0);}
  const publicKey=createPublicKey(privateKey);if(privateKey.asymmetricKeyType!=='ed25519'||!publicKey.export({format:'der',type:'spki'}).equals(createPublicKey(definition.publicKeyPem).export({format:'der',type:'spki'})))throw Error('composite_lifetime_key_binding');
  let closed=false,invalid=false;
  function current(){if(invalid)throw Error('composite_lifetime_invalidated');try{if(closed)throw Error('composite_lifetime_closed');lock.assertCurrent();checkIdentity();if(!protectedBytes(deploymentPath,65536).equals(deploymentBytes)||!protectedBytes(registrationPath,65536).equals(registrationBytes)||!protectedBytes(join(base,'egress.json'),65536).equals(egressBytes)||!protectedBytes(join(base,'participant.json'),65536).equals(participantBytes))throw Error('composite_lifetime_registration_changed');const bytes=keyBytes();try{if(createHash('sha256').update(bytes).digest('hex')!==keyHash)throw Error('composite_lifetime_key_changed');}finally{bytes.fill(0);}}catch(error){invalid=true;throw error;}}
  current();const value=Object.freeze({base,state,release,manifest,pair,definition,privateKey,publicKey,peerHelper,assertCurrent:current,close(){if(closed)return;lock.close();closed=true;}});instances.set(value,current);return value;
 }catch(error){try{lock.close();}catch(cleanupError){throw new AggregateError([error,cleanupError],'composite_lifetime_cleanup_unknown',{cause:error});}throw error;}
}
export type InstalledCompositeLifetime=ReturnType<typeof createInstalledCompositeLifetime>;
