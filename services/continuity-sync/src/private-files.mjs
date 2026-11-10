import fs from 'node:fs';
import path from 'node:path';

function safeStat(target,directory=false) {
  const s=fs.lstatSync(target);
  if(s.isSymbolicLink() || (directory?!s.isDirectory():!s.isFile()) || s.uid!==process.getuid() || (s.mode&0o077)!==0 || (!directory&&s.nlink!==1))throw new Error('unsafe_private_path');
  return s;
}
export function syncDirectory(target) {const fd=fs.openSync(target,fs.constants.O_RDONLY);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
export function privateDirectory(target) {
  // This self-hosted service is qualified for POSIX local volumes only. Windows Desktop uses its OS secret-store adapter.
  if(process.platform==='win32'||typeof process.getuid!=='function')throw new Error('private_storage_platform_unavailable');
  const resolved=path.resolve(target);
  try{fs.mkdirSync(resolved,{mode:0o700});syncDirectory(path.dirname(resolved));}catch(e){if(e.code!=='EEXIST')throw e;}
  safeStat(resolved,true);return fs.realpathSync(resolved);
}
export function privateFile(target,{create=false}={}) {
  if(create){const fd=fs.openSync(target,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}syncDirectory(path.dirname(target));}
  safeStat(target);
  for(const suffix of ['-journal','-wal','-shm']){try{safeStat(target+suffix);}catch(e){if(e.code!=='ENOENT')throw e;}}
  return target;
}
