import {afterEach,expect,it,vi}from'vitest';
import{getDesktopApi,_resetDesktopApiCache}from'../../renderer/src/shared/desktop';
const original=window.xiaokDesktop;
afterEach(()=>{window.xiaokDesktop=original;_resetDesktopApiCache();vi.restoreAllMocks();});
it.each(['meetingGetMicrophonePermission','meetingGetAsrConfig','meetingListModels']as const)('actual desktop bridge preserves %s zero tuple and rejection identity',async method=>{
 const error=Error('owned-business-failure'),produce=vi.fn().mockRejectedValue(error);window.xiaokDesktop={...original,[method]:produce};_resetDesktopApiCache();await expect(getDesktopApi()![method]()).rejects.toBe(error);expect(produce).toHaveBeenCalledExactlyOnceWith();
});
