import {afterAll,afterEach} from 'vitest';
const original={HOME:process.env.HOME,XIAOK_CONFIG_DIR:process.env.XIAOK_CONFIG_DIR,...(process.platform==='win32'?{USERPROFILE:process.env.USERPROFILE}:{})};
function restore(){for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
afterEach(restore);
afterAll(restore);
/** Select the isolated registry home; fences remain anchored to the OS account. */
export function setProfileTestHome(home:string){process.env.HOME=home;delete process.env.XIAOK_CONFIG_DIR;if(process.platform==='win32')process.env.USERPROFILE=home;}
