import {it,expect} from 'vitest';
import {buildPrivateMacEnginePlan} from '../../../src/runtime/verification/macos-engine-bootstrap.js';
it('freezes an isolated private VM configuration without host mounts, automatic downloads or broad forwarding',()=>{
 const release='/Library/Application Support/xiaok-verification/releases/'+'a'.repeat(64),state='/Library/Application Support/xiaok-verification/state';
 const plan=buildPrivateMacEnginePlan({releaseRoot:release,stateRoot:state,baseImageSha256:'b'.repeat(64),dockerArchiveSha256:'c'.repeat(64),creationNonce:'d'.repeat(64)});
 const config=JSON.parse(plan.configJson);expect(config.param.controllerCreationNonce).toBe('d'.repeat(64));expect(config.provision[0]).toMatchObject({overwrite:false,path:'/etc/xiaok-controller-creation-nonce'});
 expect(config.propagateProxyEnv).toBe(false);expect(config.timezone).toBe('UTC');expect(config.user.comment).toBe('Xiaok verification service');expect(config.vmType).toBe('qemu');expect(config.mounts).toEqual([]);expect(config.base).toBeUndefined();expect(config.containerd).toEqual({system:false,user:false});expect(config.upgradePackages).toBe(false);
 expect(config.ssh).toMatchObject({loadDotSSHPubKeys:false,forwardAgent:false,forwardX11:false,forwardX11Trusted:false});
 expect(config.images).toEqual([{location:release+'/vm/base.qcow2',arch:'aarch64',digest:'sha256:'+'b'.repeat(64)}]);
 expect(config.portForwards).toContainEqual({guestIP:'0.0.0.0',guestIPMustBeZero:false,proto:'any',guestPortRange:[1,65535],ignore:true});
 expect(plan.bootstrapScript).toContain('Group=xiaokvm');expect(plan.bootstrapScript).toContain('c'.repeat(64));expect(plan.bootstrapScript).not.toMatch(/curl|wget|apt-get/);
 expect(()=>buildPrivateMacEnginePlan({releaseRoot:'/tmp/freeform',stateRoot:state,baseImageSha256:'b'.repeat(64),dockerArchiveSha256:'c'.repeat(64),creationNonce:'d'.repeat(64)})).toThrow();
});
