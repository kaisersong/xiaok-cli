import {it,expect} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
it.skipIf(process.platform!=='darwin')('compiles actual native review code, preserves every bounded byte and refuses unprivileged approval before AppKit',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-review-panel-')),native=resolve('src/runtime/verification/native');
 try {
  const executable=join(root,'text-test');
  execFileSync('/usr/bin/clang',['-O2','-Wall','-Wextra','-Werror','-fobjc-arc','-I',native,resolve('tests/runtime/verification/native/review-text.c'),join(native,'review-panel.m'),'-framework','AppKit','-framework','Foundation','-o',executable]);
  expect(spawnSync(executable,[],{timeout:5000}).status).toBe(0);
  for(const name of ['broker-authorize','broker-enroll-authorize', 'broker-publish-authorize', 'broker-application-authorize','broker-source-authorize']){
   const out=join(root,name);execFileSync('/usr/bin/clang',['-O2','-Wall','-Wextra','-Werror','-fobjc-arc',join(native,name+'.c'),join(native,'review-panel.m'),'-framework','AppKit','-framework','Foundation','-framework','Security','-framework','CoreFoundation','-lbsm','-o',out]);
   expect(spawnSync(out,['501','10','9007199254740991'],{input:'{}',timeout:5000}).status).toBe(77);
  }
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
it.skipIf(process.platform!=='darwin')('runs the actual private AppKit lifecycle: close and expiry cancel, changed content loses continue permission',()=>{
 const root=mkdtempSync(join(tmpdir(),'native-review-lifecycle-')),native=resolve('src/runtime/verification/native');
 try {
  const executable=join(root,'lifecycle');execFileSync('/usr/bin/clang',['-O2','-Wall','-Wextra','-Werror','-fobjc-arc','-I',native,resolve('tests/runtime/verification/native/review-lifecycle.m'),'-framework','AppKit','-framework','Foundation','-o',executable]);
  const result=spawnSync(executable,[],{timeout:10000,encoding:'utf8'});expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);
 }finally{rmSync(root,{recursive:true,force:true});}
},20000);
