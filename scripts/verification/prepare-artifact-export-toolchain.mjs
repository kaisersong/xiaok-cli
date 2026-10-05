import {readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {downloadArtifactExportToolchain} from './download-artifact-export-toolchain.mjs';
if(process.argv.length!==2)throw Error('Use node scripts/verification/prepare-artifact-export-toolchain.mjs');
const root=resolve(fileURLToPath(new URL('../..',import.meta.url))),lock=JSON.parse(readFileSync(new URL('./artifact-export-toolchain.lock.json',import.meta.url),'utf8')),entry=lock.hosts[`${process.platform}-${process.arch}`];
if(lock.version!=='go1.27.1'||!entry)throw Error('artifact_export_sdk_host');
const abort=new AbortController(),stop=()=>abort.abort(Error('artifact_export_sdk_cancelled'));process.on('SIGINT',stop);process.on('SIGTERM',stop);
try{const archive=await downloadArtifactExportToolchain({entry,destination:join(root,'.artifacts','solpi-build-tools',entry.filename),signal:abort.signal});console.log(JSON.stringify({archive,host:`${process.platform}-${process.arch}`,sha256:entry.sha256,size:entry.size}));}catch(error){console.error(error instanceof Error?error.message:String(error));process.exitCode=1;}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
