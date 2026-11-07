// @vitest-environment node
import {expect,it} from 'vitest';
import {createOriginalMainDshServiceSources,claimOriginalMainDshServiceSources} from '../../electron/main-dsh-service-sources.js';

it('rejects a fake pre-Services Source before reading caller objects or loading a Native realm',()=>{
 let reads=0;
 const source=new Proxy({}, {get(){reads++;throw Error('source getter');},ownKeys(){reads++;throw Error('source keys');}});
 expect(()=>createOriginalMainDshServiceSources({scope:{profileId:'a'.repeat(64),workspaceId:'b'.repeat(64)},userSource:source})).toThrow('MAIN_DSH_USER_AUTHORITY_REQUIRED');
 expect(reads).toBe(0);
});

it('does not accept caller factories, a default tenant, copied capsule or proxy lease',()=>{
 let reads=0;
 expect(()=>createOriginalMainDshServiceSources({scope:{profileId:'p',workspaceId:'w',tenantId:'t'},userSource:{},createRealm(){reads++;}})).toThrow();
 for(const candidate of [{},new Proxy({}, {get(){reads++;return null;},ownKeys(){reads++;return [];}})])
  expect(()=>claimOriginalMainDshServiceSources(candidate,{profileId:'p',workspaceId:'w'})).toThrow('DSH_MAIN_SERVICE_SOURCES_REQUIRED');
 expect(reads).toBe(0);
});
