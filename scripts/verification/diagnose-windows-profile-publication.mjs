// Failure-only CI diagnosis. Builds an instrumented copy; never publishes it as
// a reviewed production artifact or changes the original permission decisions.
import {mkdtempSync,copyFileSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
if(process.platform!=='win32')throw Error('Windows diagnostic only');
const root=mkdtempSync(join(tmpdir(),'xiaok-profile-diagnostic-'));
for(const name of ['binding.gyp','windows-owner-security.c','windows-profile-custody.c','windows-activity-permissions.h'])copyFileSync(resolve('native/windows-owner-security',name),join(root,name));
const source=join(root,'windows-profile-custody.c');let text=readFileSync(source,'utf8');
const start=text.indexOf('static napi_value publish_profile_file('),end=text.indexOf('\nnapi_value init_windows_profile_custody',start);
if(start<0||end<0)throw Error('diagnostic source shape');
let body=text.slice(start,end);
for(const expression of ['FlushFileBuffers(handle)','canonical_path(handle,source)','canonical_path(handle,destination)','snapshot(handle,user,&identity,&sddl,1,0)','SetFileInformationByHandle(handle,FileRenameInfo,rename,size)'])body=body.replaceAll(expression,`PROFILE_DIAG(${JSON.stringify(expression)},${expression})`);
body=body.replace(' done:if(handle', ' done:if(!ok){DWORD e=GetLastError();fprintf(stderr,"profile_publish_diagnostic_done error=%lu\\n",(unsigned long)e);}if(handle');
text=text.slice(0,start)+'#define PROFILE_DIAG(label,call) ((call)?1:(fprintf(stderr,"profile_publish_diagnostic call=%s line=%d error=%lu\\n",label,__LINE__,(unsigned long)GetLastError()),0))\n'+body+text.slice(end);writeFileSync(source,text);
text=readFileSync(source,'utf8').replace('free(final);return ok;', 'if(!ok)fwprintf(stderr,L"profile_path_mismatch actual=%ls expected=%ls size=%lu\\n",final,expected,(unsigned long)size);free(final);return ok;');writeFileSync(source,text);
console.log(JSON.stringify({kind:'windows-profile-publication-diagnostic',root,productionQualified:false}));
const build=spawnSync(process.execPath,[resolve('node_modules/node-gyp/bin/node-gyp.js'),'rebuild','--directory',root],{stdio:'inherit',windowsHide:true,timeout:180000});
if(build.error||build.status!==0)throw Error('diagnostic build failed',{cause:build.error});
const result=spawnSync(process.execPath,['--test','--test-name-pattern=atomic private publication','tests/native/windows-profile-custody.test.cjs'],{env:{...process.env,XIAOK_WINDOWS_SECURITY_TEST_ADDON:join(root,'build/Release/windows_owner_security.node')},stdio:'inherit',windowsHide:true,timeout:30000});
process.exitCode=result.error||result.status!==0?1:0;
