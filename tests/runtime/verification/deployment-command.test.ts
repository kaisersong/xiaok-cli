import {it,expect} from 'vitest';
import {runDeploymentCommand} from '../../../src/runtime/verification/deployment-command.js';
it('rejects unknown commands and malformed privileged initialization without effects',()=>{
 expect(()=>runDeploymentCommand(['serve'])).toThrow('deployment_command');
 expect(()=>runDeploymentCommand(['initialize-state','x','1'])).toThrow();
 expect(()=>runDeploymentCommand(['deployment-preflight','--release-root','/tmp'])).toThrow('deployment_command');
});
it('routes the fixed first-provision command through real root authorization',()=>{
 if(process.getuid?.()!==0)expect(()=>runDeploymentCommand(['provision-egress','a'.repeat(64)])).toThrow('root_required');
 expect(()=>runDeploymentCommand(['provision-egress','a'.repeat(64),'untrusted-path'])).toThrow('deployment_command');
});
