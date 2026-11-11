import {copyFileSync,chmodSync,writeFileSync,readFileSync,constants} from 'node:fs';
import {join,resolve} from 'node:path';
const desktopRoot=resolve(__dirname,'..','..');
const lock=JSON.parse(readFileSync(join(desktopRoot,'resources','broker-runtime-lock.json'),'utf8'));
/** Ordinary file-identity fixture only; these bytes grant no Native authority. */
export function populateBrokerRuntimeFixture(dir:string,target:'darwin-arm64'|'win32-x64') {
  const entry=lock.targets[target];
  const inputs=process.env.XIAOK_TEST_BROKER_RUNTIME_INPUTS??resolve(desktopRoot,'..','.artifacts','broker-runtimes');
  for(const name of [entry.executable,'LICENSE'])copyFileSync(join(inputs,target,name),join(dir,name),constants.COPYFILE_FICLONE);
  // prepare-broker-runtime writes the cached executable as 0o500, which Windows maps to the
  // read-only attribute and copyFileSync preserves; the fixture must own a writable copy.
  chmodSync(join(dir,entry.executable),process.platform==='win32'?0o666:0o700);
  const manifest={schema:'xiaok-broker-runtime/v1',target,node:lock.node,sqlite:lock.sqlite,executable:entry.executable,archiveSha256:entry.archiveSha256,executableSha256:entry.executableSha256,executableSize:entry.executableSize,licenseSha256:entry.licenseSha256,licenseSize:entry.licenseSize};
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));
  return {command:join(dir,entry.executable),manifest,restoreBinary(){copyFileSync(join(inputs,target,entry.executable),join(dir,entry.executable));if(process.platform==='win32')chmodSync(join(dir,entry.executable),0o666);}};
}
