#!/usr/bin/env node
// Build data only. No installation, signing, Main launch or authority grant.
import {createHash} from 'node:crypto';
import {constants,openSync,closeSync,fchmodSync,cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,readlinkSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
const repo=dirname(dirname(fileURLToPath(import.meta.url)));
const environment=Object.freeze({PATH:'/usr/bin:/bin',LC_ALL:'C'}),children=[];
const fail=reason=>{throw Error('MI_ARTIFACT_'+reason);};
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const inside=(root,path)=>{const part=relative(root,path);return part===''||(!isAbsolute(part)&&part!=='..'&&!part.startsWith('..'+sep));};
function run(command,args){
 const result=spawnSync(command,args,{env:environment,encoding:'utf8'});
 const record={pid:result.pid,command,args,exitCode:result.status,signal:result.signal,reaped:result.pid!==undefined,stdout:result.stdout,stderr:result.stderr};children.push(record);console.log(JSON.stringify({kind:'installation-artifact-build-child',...record}));
 if(result.error||result.status!==0)fail('BUILD_FAILED');return result.stdout;
}
function tree(root,path=root){
 const stat=lstatSync(path);if(stat.isSymbolicLink()){
  const target=readlinkSync(path);if(isAbsolute(target)||!inside(root,realpathSync(path)))fail('SOURCE_LINK_ESCAPE');return {name:relative(root,path),mode:stat.mode,link:target};
 }
 if(stat.isDirectory())return {name:relative(root,path),mode:stat.mode,entries:readdirSync(path).sort().map(name=>tree(root,join(path,name)))};
 if(!stat.isFile()||stat.nlink!==1)fail('SOURCE_FILE_KIND');return {name:relative(root,path),mode:stat.mode,size:stat.size,sha256:hash(readFileSync(path))};
}
function preserveDirectoryModes(source,target){
 const actual=lstatSync(source);if(!actual.isDirectory())return;
 const fd=openSync(target,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
 try{fchmodSync(fd,actual.mode&0o777);}finally{closeSync(fd);}
 for(const name of readdirSync(source))preserveDirectoryModes(join(source,name),join(target,name));
}
function main(){
 if(process.platform!=='darwin')fail('PLATFORM_UNAVAILABLE');
 const args=process.argv.slice(2);if(args.length!==4||args[0]!=='--app'||args[2]!=='--out')fail('ARGUMENT_INVALID');
 const app=realpathSync(resolve(args[1]));if(!lstatSync(app).isDirectory())fail('APP_REQUIRED');
 const requested=resolve(args[3]),parent=realpathSync(dirname(requested)),out=join(parent,basename(requested));
 if(existsSync(out)||lstatSync(parent).isSymbolicLink()||inside(app,out)||inside(out,app)||inside('/Library',out)||inside('/Applications',out)||inside('/System',out))fail('OUTPUT_UNAVAILABLE');
 const before=tree(app);
 const executable=run('/usr/bin/plutil',['-extract','CFBundleExecutable','raw','-o','-',join(app,'Contents','Info.plist')]).trim();
 if(!/^[A-Za-z0-9._-]{1,128}$/.test(executable)||executable==='.'||executable==='..')fail('EXECUTABLE_BASENAME');
 const binary=join(app,'Contents','MacOS',executable);if(!lstatSync(binary).isFile()||lstatSync(binary).isSymbolicLink())fail('EXECUTABLE_REQUIRED');
 const targetArchitectures=run('/usr/bin/lipo',['-archs',binary]).trim().split(/\s+/);
 const architecture=process.arch==='arm64'?'arm64':process.arch==='x64'?'x86_64':fail('ARCHITECTURE_UNAVAILABLE');
 if(targetArchitectures.length!==1||targetArchitectures[0]!==architecture)fail('TARGET_ARCHITECTURE_UNSUPPORTED');
 const sources=['main-installation-helper.c','main-installation-entry.c','main-installation-certifier.c','wire.c','wire.h','protocol.h','root-store-state.h','root-store-io.h','root-store-receipts.h','authority-family-io.h','installation-closure.h','installation-release.h','installation-certificate.h'];
 const source=join(repo,'native/main-installation'),sourceHashes=Object.fromEntries(sources.map(name=>[name,hash(readFileSync(join(source,name)))]));
 // mkdir is the one exclusive output reservation; partial failures are retained.
 mkdirSync(out,{mode:0o700});
 const configuration=join(out,'configuration.h');writeFileSync(configuration,`#define MI_MAIN_EXEC MI_MAIN_BUNDLE "/Contents/MacOS/${executable}"\n`,{flag:'wx',mode:0o600});
 const sdk=run('/usr/bin/xcrun',['--show-sdk-path']).trim();
 const common=['-std=c11','-Wall','-Wextra','-Werror','-Wno-deprecated-declarations','-arch',architecture,'-isysroot',sdk,'-I',source,'-DMI_CONFIGURATION_HEADER='+JSON.stringify(configuration)];
 for(const name of ['main-installation-helper','main-installation-entry','main-installation-certifier'])run('/usr/bin/cc',[...common,join(source,name+'.c'),join(source,'wire.c'),'-framework','Security','-framework','CoreFoundation','-framework','OpenDirectory','-lbsm','-o',join(out,name)]);
 cpSync(app,join(out,'Xiaok.app'),{recursive:true,dereference:false,verbatimSymlinks:true,preserveTimestamps:true,errorOnExist:true,force:false});preserveDirectoryModes(app,join(out,'Xiaok.app'));
 const after=tree(app);if(JSON.stringify(after)!==JSON.stringify(before)||JSON.stringify(tree(join(out,'Xiaok.app')))!==JSON.stringify(before))fail('SOURCE_OR_COPY_CHANGED');
 for(const [name,sha]of Object.entries(sourceHashes))if(hash(readFileSync(join(source,name)))!==sha)fail('SOURCE_DRIFT');
 const artifacts=Object.fromEntries(['main-installation-helper','main-installation-entry','main-installation-certifier','configuration.h'].map(name=>[name,hash(readFileSync(join(out,name)))]));
 writeFileSync(join(out,'receipt.json'),JSON.stringify({buildKind:0,installed:false,signed:false,guiSpawns:0,architecture,targetArchitectures,sdk,mainExecutableBasename:executable,sourceHashes,artifacts,inputTree:before,inputTreeUnchanged:true,children,requiresExternalRootInstallation:true,requiresExternalSigning:true,productionQualified:false},null,2)+'\n',{flag:'wx',mode:0o600});
}
try{main();}catch(raw){const message=raw&&typeof raw==='object'?Object.getOwnPropertyDescriptor(raw,'message')?.value:undefined;console.error(typeof message==='string'?message:'MI_ARTIFACT_UNKNOWN_FAILURE');process.exitCode=1;}
