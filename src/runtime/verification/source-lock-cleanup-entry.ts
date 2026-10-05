import {cleanupOriginalSourceLocks} from './source-lock-cleanup.js';
try{process.stdout.write(JSON.stringify(cleanupOriginalSourceLocks(process.argv.slice(2)))+'\n');}
catch{process.stderr.write('source_lock_cleanup_unresolved\n');process.exitCode=1;}
