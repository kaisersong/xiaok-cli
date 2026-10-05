import {it,expect} from 'vitest';
import {attachInstalledMacEngineForMaintenance,readMaintenanceEngineAttachment} from '../../../src/runtime/verification/maintenance-engine-attachment.js';
it('requires an actual installed lifetime before reading guest configuration',async()=>{await expect(attachInstalledMacEngineForMaintenance({lifetime:{}} as any)).rejects.toThrow('controller_lifetime_identity');expect(()=>readMaintenanceEngineAttachment({} as any,{} as any)).toThrow('maintenance_engine_identity');});
