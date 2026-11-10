import {pathToFileURL} from 'node:url';
if(process.argv[4]==='import-entry')await import(pathToFileURL(process.argv[5]).href);
const {serveConversationActivityOwner}=await import(pathToFileURL(process.argv[3]).href);
await serveConversationActivityOwner(process.argv[2]);
