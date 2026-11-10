import {spawnSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,lstatSync,realpathSync,renameSync,rmSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
// This is a build entry. It never starts a Main, helper, service, or installer.
if(process.platform!=='darwin'){
 console.log(JSON.stringify({kind:'kswarm-authority-desktop-build',platform:process.platform,available:false,qualification:false}));
}else{
 const source=dirname(fileURLToPath(import.meta.url)),repo=resolve(source,'../..'),args=process.argv.slice(2);
 if(args.length!==0&&(args.length!==2||args[0]!=='--headers'))throw Error('KSWARM_AUTHORITY_BUILD_ARGUMENT_INVALID');
 // C-only N-API 8 uses the actual build Node distribution headers, not V8 or a
 // test Main's SDK. A bare Node download may supply the build-only override.
 const headers=realpathSync(args.length?resolve(args[1]):resolve(dirname(realpathSync(process.execPath)),'../include/node'));
 if(!lstatSync(join(headers,'node_api.h')).isFile())throw Error('KSWARM_AUTHORITY_NODE_API_HEADERS_REQUIRED');
 const require=createRequire(join(repo,'desktop/package.json'));
 const dependency=dirname(require.resolve('better-sqlite3/package.json'));
 const parent=join(source,'build'),output=join(parent,'Release');mkdirSync(parent,{recursive:true});
 if(lstatSync(parent).isSymbolicLink())throw Error('KSWARM_AUTHORITY_BUILD_DIRECTORY_INVALID');
 if(existsSync(output)){
  if(!lstatSync(output).isDirectory()||lstatSync(output).isSymbolicLink())throw Error('KSWARM_AUTHORITY_BUILD_OUTPUT_INVALID');
  const old=JSON.parse(readFileSync(join(output,'source-manifest.json'),'utf8'));
  if(old.kind!=='original_kswarm_authority_build_v1')throw Error('KSWARM_AUTHORITY_BUILD_OUTPUT_NOT_OWNED');
 }
 const temporary=mkdtempSync(join(parent,'.kswarm-build-'));
 const p=spawnSync(process.execPath,[join(source,'build.mjs'),headers,temporary,dependency],{cwd:repo,encoding:'utf8',timeout:120000});
 const record={kind:'kswarm-authority-desktop-build',pid:p.pid,status:p.status,signal:p.signal,stdout:p.stdout,stderr:p.stderr,temporary,qualification:false,installed:false};
 writeFileSync(join(temporary,'prepare-run.json'),JSON.stringify(record,null,2)+'\n');
 if(p.error||p.status!==0||p.signal)throw Error('KSWARM_AUTHORITY_DESKTOP_BUILD_FAILED: '+(p.stderr||p.stdout),{cause:p.error});
 let previous;
 if(existsSync(output)){previous=temporary+'-previous';renameSync(output,previous);}
 try{renameSync(temporary,output);}catch(raw){if(previous)renameSync(previous,output);throw raw;}
 // Only the generated directory verified above is retired. Failed builds remain
 // in their private staging directory with the original child and error record.
 if(previous)rmSync(previous,{recursive:true});
 const manifest=readFileSync(join(output,'source-manifest.json'));
 console.log(JSON.stringify({...record,temporary:undefined,output,manifestSha256:createHash('sha256').update(manifest).digest('hex')}));
}
