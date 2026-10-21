import {it,expect,vi} from 'vitest';
const state=vi.hoisted(()=>({profile:{kind:'ordinary'} as any,migration:{kind:'ordinary'} as any,reads:0}));
vi.mock('../../../src/runtime/verification/migration-markers.js',()=>({readInstalledCurrentProfile:()=>state.profile,readInstalledMigrationOwner:()=>{state.reads++;return state.migration;}}));
import {readInstalledCurrentOwner} from '../../../src/runtime/verification/installed-owner-state.js';
const index={version:1,uid:501,accountId:'11111111-aaaa-bbbb-cccc-555555555555',authorityId:'authority',profileId:'actual'};
it('uses only the OS profile and never downgrades a protected index when owner metadata is absent',()=>{
 state.reads=0;state.profile={kind:'ordinary'};expect(readInstalledCurrentOwner({ownerKind:'task',ownerId:'one'})).toEqual({kind:'ordinary'});expect(state.reads).toBe(0);
 state.profile={kind:'protected',index};state.migration={kind:'ordinary'};
 expect(readInstalledCurrentOwner({ownerKind:'task',ownerId:'one'})).toEqual({kind:'protected-unregistered',authorityId:'authority',owner:{profileId:'actual',ownerKind:'task',ownerId:'one'}});
 expect(readInstalledCurrentOwner({profileId:'forged',ownerKind:'task',ownerId:'one'} as any)).toEqual({kind:'unavailable',reason:'migration_authority_unavailable'});
});
it('rejects authority and owner mismatches and keeps pending or unavailable fail closed',()=>{
 state.profile={kind:'protected',index};state.migration={kind:'unavailable',reason:'migration_authority_unavailable'};expect(readInstalledCurrentOwner({ownerKind:'task',ownerId:'one'}).kind).toBe('unavailable');
 state.migration={kind:'protected-unregistered',authorityId:'other'};expect(readInstalledCurrentOwner({ownerKind:'task',ownerId:'one'}).kind).toBe('unavailable');
 const marker={authorityId:'authority',profileId:'actual',ownerKind:'task',ownerId:'one',state:'pending'};state.migration={kind:'pending',marker};expect(readInstalledCurrentOwner({ownerKind:'task',ownerId:'one'}).kind).toBe('pending');
 state.migration={kind:'pending',marker:{...marker,ownerId:'two'}};expect(readInstalledCurrentOwner({ownerKind:'task',ownerId:'one'}).kind).toBe('unavailable');
});
