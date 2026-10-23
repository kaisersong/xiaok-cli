import {isKSwarmOwnerIdentity} from './kswarm-host-subject.js';
import {readInstalledCurrentProfile,readInstalledMigrationOwner,type MigrationMarker} from './migration-markers.js';
import type {VerificationOwner} from './proof-authority.js';
import {canonicalVerificationJson as json} from './protocol.js';
export type InstalledCurrentOwner=
 |{kind:'ordinary'}|{kind:'unavailable';reason:'migration_authority_unavailable'}
 |{kind:'protected-unregistered';authorityId:string;owner:Readonly<VerificationOwner>}
 |{kind:'pending'|'migrated';authorityId:string;owner:Readonly<VerificationOwner>;marker:Readonly<MigrationMarker>};
/** Public product lookup has no profile/root override. A fixed OS profile index
 * remains protected even before owner enrollment or migration marker publication. */
export function readInstalledCurrentOwner(raw:Pick<VerificationOwner,'ownerKind'|'ownerId'>):Readonly<InstalledCurrentOwner>{
 try{
  if(!raw||typeof raw!=='object'||Object.keys(raw).sort().join(',')!=='ownerId,ownerKind'||!(['task','intent','goal','loop','project'].includes(raw.ownerKind)||isKSwarmOwnerIdentity(raw))||typeof raw.ownerId!=='string'||!raw.ownerId||Buffer.byteLength(raw.ownerId)>160||/[\x00-\x1f\x7f]/.test(raw.ownerId))throw Error('installed_owner_identity');
  const profile=readInstalledCurrentProfile();if(profile.kind!=='protected')return profile;
  const owner=Object.freeze({profileId:profile.index.profileId,ownerKind:raw.ownerKind,ownerId:raw.ownerId}),authorityId=profile.index.authorityId,state=readInstalledMigrationOwner(owner);
  if(state.kind==='unavailable')return state;
  if(state.kind==='ordinary'||state.kind==='protected-unregistered'){
   if(state.kind==='protected-unregistered'&&state.authorityId!==authorityId)throw Error('installed_owner_authority');
   return Object.freeze({kind:'protected-unregistered',authorityId,owner});
  }
  const marker=state.marker;
  if(marker.authorityId!==authorityId||marker.state!==state.kind||json({profileId:marker.profileId,ownerKind:marker.ownerKind,ownerId:marker.ownerId})!==json(owner))throw Error('installed_owner_binding');
  return Object.freeze({kind:state.kind,authorityId,owner,marker});
 }catch{return Object.freeze({kind:'unavailable',reason:'migration_authority_unavailable'});}
}
