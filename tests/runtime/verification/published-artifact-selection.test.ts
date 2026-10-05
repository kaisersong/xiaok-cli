import {expect,it} from 'vitest';
import {parsePublishedArtifactSelection} from '../../../src/runtime/verification/published-artifact-selection.js';
it.each([
 {kind:'local',obligationId:'original',path:'out/report.txt'},
 {kind:'inherited',obligationId:'inherited',path:'out/report.txt',originOwner:{profileId:'p',ownerKind:'task',ownerId:'child'},originalObligationId:'original'},
])('captures exact local/inherited selection without granting path access: %j',raw=>{
 const value=parsePublishedArtifactSelection(raw);expect(value).toEqual(raw);expect(Object.isFrozen(value)).toBe(true);
 raw.path='different';expect(value.path).toBe('out/report.txt');if(value.kind==='inherited')expect(Object.isFrozen(value.originOwner)).toBe(true);
});
it.each(['../secret','/absolute','a\\b','C:/secret','a//b','a/./b','a\0b','https://example.test/a'])('rejects a host path or malformed artifact logical path: %s',path=>{
 expect(()=>parsePublishedArtifactSelection({kind:'local',obligationId:'original',path})).toThrow(/published_artifact/);
});
it('rejects substituted branches, extra grants and getter evaluation',()=>{
 const local={kind:'local',obligationId:'original',path:'out.txt'};
 for(const raw of [{...local,kind:'url'},{...local,readGrant:{}},{...local,kind:'inherited'},{...local,obligationId:''}])expect(()=>parsePublishedArtifactSelection(raw)).toThrow();
 let reads=0;expect(()=>parsePublishedArtifactSelection({...local,get path(){reads++;return 'out.txt';}})).toThrow();expect(reads).toBe(0);
});
