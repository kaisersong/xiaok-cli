import {afterAll} from 'vitest';
const original={HOME:process.env.HOME,XIAOK_CONFIG_DIR:process.env.XIAOK_CONFIG_DIR};
afterAll(()=>{for(const [key,value] of Object.entries(original)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
/** Existing account fixtures must select the environment-based registry too. */
export function setProfileTestHome(home:string){process.env.HOME=home;delete process.env.XIAOK_CONFIG_DIR;}
