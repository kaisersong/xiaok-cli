import {closeSync,constants,fstatSync,lstatSync,openSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {userInfo} from 'node:os';

/** Read-only consumers never initialize identity or create a missing directory. */
export function readContinuityProfile(dataRoot:string):string {
  const path=join(dataRoot,'continuity-profile.json');
  const info=userInfo(),osOwner=process.platform==='win32'?info.username:String(info.uid);
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4096) throw new Error();
    const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const opened = fstatSync(fd);
      if (!opened.isFile() || opened.size > 4096 || opened.dev !== stat.dev || opened.ino !== stat.ino || typeof process.getuid === 'function' && opened.uid !== process.getuid()) throw new Error();
      const record = JSON.parse(readFileSync(fd, 'utf8')) as { version?: number; profileId?: unknown; osOwner?: unknown };
      if (record.version !== 1 || record.osOwner !== osOwner || typeof record.profileId !== 'string'
        || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(record.profileId)) throw new Error();
      return record.profileId;
    } finally { closeSync(fd); }
  } catch { throw new Error('profile_identity_unavailable'); }
}
