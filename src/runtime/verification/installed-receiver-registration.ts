import {createHash,createPublicKey,type KeyObject} from 'node:crypto';
import {readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {assertInstalledControllerLifetime,type InstalledControllerLifetime} from './installed-controller-lifetime.js';
import {assertRootProtectedFile} from './installed-identity.js';
import {createReceiverReplyVerifier} from './receiver-authentication.js';
import {canonicalVerificationJson as json} from './protocol.js';
export interface InstalledReceiverDefinition {version:1;receiverId:string;receiverInstanceEpoch:number;keyId:string;publicKeyPem:string;serviceUid:number}
const registrations=new WeakMap<object,{lifetime:Readonly<InstalledControllerLifetime>;assertCurrent():void}>();
export function assertInstalledReceiverRegistration(value:object,lifetime:Readonly<InstalledControllerLifetime>){const known=registrations.get(value);if(!known||known.lifetime!==lifetime)throw Error('receiver_registration_identity');known.assertCurrent();}
/** Parsing config does not prove a live receiver or its durable instance epoch. */
export function parseInstalledReceiverRegistration(raw:unknown,policy:{controllerPublicKey:KeyObject;controllerServiceUid:number;interactiveUids:readonly number[]}):Readonly<InstalledReceiverDefinition>{
 const text=json(raw);if(Buffer.byteLength(text)>65536)throw Error('receiver_registration_limit');const m=JSON.parse(text);
 if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).sort().join(',')!=='keyId,publicKeyPem,receiverId,receiverInstanceEpoch,serviceUid,version'||m.version!==1||typeof m.receiverId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(m.receiverId)||!Number.isSafeInteger(m.receiverInstanceEpoch)||m.receiverInstanceEpoch<1||typeof m.publicKeyPem!=='string'||m.publicKeyPem.length>8192||typeof m.keyId!=='string'||!/^[a-f0-9]{64}$/.test(m.keyId)||!Number.isSafeInteger(m.serviceUid)||m.serviceUid<1||m.serviceUid>=0xffffffff||m.serviceUid===policy.controllerServiceUid||policy.interactiveUids.includes(m.serviceUid))throw Error('receiver_registration_schema');
 const key=createPublicKey(m.publicKeyPem),der=key.export({format:'der',type:'spki'}),controller=policy.controllerPublicKey.export({format:'der',type:'spki'});
 if(key.asymmetricKeyType!=='ed25519'||der.equals(controller)||createHash('sha256').update(der).digest('hex')!==m.keyId)throw Error('receiver_registration_key');return Object.freeze(m);
}
/** Fixed installed read-only registration. Separate receiver service/DB must still
 * authenticate socket peers and its original durable epoch before any commit. */
export function createInstalledReceiverRegistration(lifetime:Readonly<InstalledControllerLifetime>){
 assertInstalledControllerLifetime(lifetime);const path=join(lifetime.base,'receiver.json');
 function bytes(){assertRootProtectedFile(path);if(lstatSync(path).size>65536)throw Error('receiver_registration_limit');return readFileSync(path);}
 const original=bytes(),definition=parseInstalledReceiverRegistration(JSON.parse(original.toString('utf8')),{controllerPublicKey:lifetime.publicKey,controllerServiceUid:lifetime.manifest.serviceUid,interactiveUids:[...lifetime.manifest.allowedUserIds]});
 const identity=Object.freeze({receiverId:definition.receiverId,receiverInstanceEpoch:definition.receiverInstanceEpoch,keyId:definition.keyId}),verifier=createReceiverReplyVerifier({...identity,publicKey:createPublicKey(definition.publicKeyPem)});let closed=false;
 function current(){if(closed)throw Error('receiver_registration_closed');try{assertInstalledControllerLifetime(lifetime);if(!bytes().equals(original))throw Error('receiver_registration_changed');}catch(error){closed=true;verifier.revoke();throw error;}}
 const receiverVerifier:ObjectReturn=Object.freeze({revoke(){closed=true;verifier.revoke();},verify(...args:Parameters<typeof verifier.verify>){current();const reply=verifier.verify(...args);current();return reply;},read(...args:Parameters<typeof verifier.read>){current();const result=verifier.read(...args);current();return result;}});
 const result=Object.freeze({identity,definition,receiverVerifier,socketPath:join(lifetime.base,'receiver','receiver.sock'),assertCurrent:current,close(){closed=true;verifier.revoke();}});registrations.set(result,{lifetime,assertCurrent:current});return result;
}
type ObjectReturn=ReturnType<typeof createReceiverReplyVerifier>;
