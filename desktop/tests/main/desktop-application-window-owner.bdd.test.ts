// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DesktopApplicationWindowOwner,readOriginalDesktopApplicationWindowOwnerView } from '../../electron/desktop-application-window-owner.js';

describe('BDD: application bootstrap is independent of window lifetime', () => {
  it('A1/U3 Given concurrent opens and a later destroyed view, Then bootstrap runs once and replacement only creates a view', async () => {
    let bootCount = 0; let viewCount = 0; let current: { id: number; destroyed: boolean } | null = null;
    let resolveBoot!: () => void; const barrier = new Promise<void>(resolve => { resolveBoot = resolve; });
    const owner = new DesktopApplicationWindowOwner({
      current: () => current && !current.destroyed ? current : null,
      bootstrap: async () => { ++bootCount; await barrier; return current = { id: 1, destroyed: false }; },
      createView: async () => { ++viewCount; return current = { id: 2, destroyed: false }; },
    });
    const first = owner.open(); const concurrent = owner.open(); resolveBoot();
    expect(await first).toBe(await concurrent); expect(bootCount).toBe(1);
    current!.destroyed = true;
    expect((await owner.open()).id).toBe(2); expect(viewCount).toBe(1); expect(bootCount).toBe(1);
  });

  it('A1 Given partially failed bootstrap, Then subsequent opens report the original failure and never initialize a second runtime', async () => {
    let boots = 0; let views = 0;
    const owner = new DesktopApplicationWindowOwner({ current: () => null,
      bootstrap: async () => { ++boots; throw new Error('partial initialization'); }, createView: async () => { ++views; return {}; } });
    await expect(owner.open()).rejects.toThrow('partial initialization');
    await expect(owner.open()).rejects.toThrow('partial initialization');
    expect(boots).toBe(1); expect(views).toBe(0);
  });

  it('pins original ports and exposes only a passive original view with a monotonic observation epoch',async()=>{
    const first={},second={};let current:object|null=first,boots=0,views=0;
    const ports={current:()=>current,bootstrap:async()=>{boots++;return first;},createView:async()=>{views++;return second;}};
    const owner=new DesktopApplicationWindowOwner(ports),before=readOriginalDesktopApplicationWindowOwnerView(owner);
    expect(before.window).toBe(first);expect({boots,views}).toEqual({boots:0,views:0});
    ports.current=()=>second;ports.bootstrap=async()=>{throw Error('replaced bootstrap');};ports.createView=async()=>{throw Error('replaced view');};
    expect(await owner.open()).toBe(first);const booted=readOriginalDesktopApplicationWindowOwnerView(owner);expect(booted.window).toBe(first);expect(booted.viewEpoch).toBeGreaterThan(before.viewEpoch);expect(()=>before.assertLocal()).toThrow();booted.assertLocal();
    current=null;const missing=readOriginalDesktopApplicationWindowOwnerView(owner);expect(missing.viewEpoch).toBeGreaterThan(before.viewEpoch);
    expect(await owner.open()).toBe(second);expect({boots,views}).toEqual({boots:1,views:1});
    current=first;expect(readOriginalDesktopApplicationWindowOwnerView(owner).viewEpoch).toBeGreaterThan(missing.viewEpoch);
  });

  it('rejects foreign owners without Proxy reflection and retains the exact first undefined observation failure',()=>{
    let traps=0;const foreign=new Proxy({},{get(){traps++;throw Error('trap');},getOwnPropertyDescriptor(){traps++;throw Error('trap');}});
    expect(()=>readOriginalDesktopApplicationWindowOwnerView(foreign)).toThrow('DESKTOP_APPLICATION_WINDOW_OWNER_REQUIRED');expect(traps).toBe(0);
    let failed=true,calls=0;const owner=new DesktopApplicationWindowOwner({current(){calls++;if(failed)throw undefined;return {};},bootstrap:async()=>({}),createView:async()=>({})});
    for(let i=0;i<2;i++){let present=false,value:unknown=1;try{readOriginalDesktopApplicationWindowOwnerView(owner);}catch(error){present=true;value=error;}expect(present).toBe(true);expect(value).toBeUndefined();failed=false;}
    expect(calls).toBe(1);
  });

  it('retries a failed replacement view without repeating the completed bootstrap',async()=>{
    const first={};let boots=0,views=0;const owner=new DesktopApplicationWindowOwner({current:()=>null,bootstrap:async()=>{boots++;return first;},createView:async()=>{if(++views===1)throw Error('view failed');return {};}});
    await owner.open();await expect(owner.open()).rejects.toThrow('view failed');await expect(owner.open()).resolves.toEqual({});expect({boots,views}).toEqual({boots:1,views:2});
  });
});
