import {it,expect,vi,afterEach} from 'vitest';
const fixture=vi.hoisted(()=>({kind:'ordinary'}));
vi.mock('../../../src/runtime/verification/windows-installation-absence.js',()=>({readWindowsInstallationAbsence:()=>fixture.kind}));
import {readInstalledCurrentProfile} from '../../../src/runtime/verification/migration-markers.js';
afterEach(()=>{vi.restoreAllMocks();});
it('actual profile reader allows only the packaged native helper confirmed Windows absence',()=>{
 vi.spyOn(process,'platform','get').mockReturnValue('win32');fixture.kind='ordinary';expect(readInstalledCurrentProfile()).toEqual({kind:'ordinary'});
 for(const kind of ['installed','unavailable']){fixture.kind=kind;expect(readInstalledCurrentProfile()).toEqual({kind:'unavailable',reason:'migration_authority_unavailable'});}
});
