import {describe,it,expect} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {migrateAssistantCalendar,readAssistantCalendarMemorySettings,setAssistantCalendarMemorySettings} from '../../electron/assistant-calendar-store.js';
describe('independent memory consent',()=>{
 it('defaults off, isolates owner/profile, requires user and rejects stale revision',()=>{
  const db=new DatabaseSync(':memory:');try{
   migrateAssistantCalendar(db);const key={ownerId:'owner',profileId:'profile'};
   expect(readAssistantCalendarMemorySettings(db,key)).toEqual({...key,enabled:false,revision:0});
   for(const requestSource of ['agent','scheduler'] as const)expect(()=>setAssistantCalendarMemorySettings(db,{...key,enabled:true,expectedRevision:0,requestSource})).toThrow('user_only');
   expect(setAssistantCalendarMemorySettings(db,{...key,enabled:true,expectedRevision:0,requestSource:'user'})).toMatchObject({enabled:true,revision:1});
   expect(readAssistantCalendarMemorySettings(db,{...key,ownerId:'other'}).enabled).toBe(false);
   expect(readAssistantCalendarMemorySettings(db,{...key,profileId:'other'}).enabled).toBe(false);
   expect(()=>setAssistantCalendarMemorySettings(db,{...key,enabled:false,expectedRevision:0,requestSource:'user'})).toThrow('conflict');
   expect(setAssistantCalendarMemorySettings(db,{...key,enabled:false,expectedRevision:1,requestSource:'user'})).toMatchObject({enabled:false,revision:2});
  }finally{db.close();}
 });
});
