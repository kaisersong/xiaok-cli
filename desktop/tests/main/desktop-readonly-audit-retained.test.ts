import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,dirname,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {createDesktopReadonlyAuditProfile,createDesktopReadonlyAuditRegistry,READONLY_AUDIT_FILES} from '../../electron/desktop-readonly-audit.js';
import {DesktopToolCatalogBridge} from '../../electron/desktop-multi-agent-catalog-bridge.js';
it('retained actual scoped native read is denied after disposal and workspace revocation',async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'assistant-handoff-'))),workspace=join(root,'workspace'),dataRoot=join(root,'data'),configDir=join(root,'config');
 for(const dir of [workspace,dataRoot,configDir])mkdirSync(dir);
 try{
  const manifest=READONLY_AUDIT_FILES.map(file=>{const target=join(workspace,file);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,readFileSync(resolve('..',file)));return {path:file,sha256:createHash('sha256').update(readFileSync(target)).digest('hex')};});
  writeFileSync(join(root,'session.json'),JSON.stringify({root,workspace,dataRoot,configDir}));writeFileSync(join(root,'source-manifest.json'),JSON.stringify(manifest));
  const {registry}=createDesktopReadonlyAuditRegistry(createDesktopReadonlyAuditProfile(root)),bridge=new DesktopToolCatalogBridge({registry,workspaceId:'workspace'});bridge.authorizeRoot();
  const scope=()=>bridge.catalog.createScopedRegistry(bridge.catalog.snapshotPolicy(),{groupId:'g',agentId:'root_g',turnId:'t',cwd:workspace,workspaceId:'workspace',materialIds:[],permissionRevision:bridge.catalog.permissionRevision('workspace'),signal:new AbortController().signal,deadlineAt:Date.now()+10000},{nativeReadonlyOnly:true});
  const first=scope(),retained=first.registry.getRegisteredTool('read')!;expect(await retained.execute({file_path:join(workspace,READONLY_AUDIT_FILES[0])})).toContain('ASSISTANT_MORNING_LOOP_ID');first.dispose();
  await expect(retained.execute({file_path:join(workspace,READONLY_AUDIT_FILES[0])})).rejects.toThrow(/disposed/);
  const second=scope(),revoked=second.registry.getRegisteredTool('read')!;bridge.catalog.revokeWorkspace({requestSource:'user',workspaceId:'workspace'});
  await expect(revoked.execute({file_path:join(workspace,READONLY_AUDIT_FILES[0])})).rejects.toThrow(/revoked/);
  second.dispose();bridge.dispose();registry.dispose();
 }finally{rmSync(root,{recursive:true,force:true});}
});
