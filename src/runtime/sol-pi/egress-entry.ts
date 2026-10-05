import {startInstalledCompositeEgress} from './installed-composite-services.js';
async function main(){if(process.argv.length!==2)throw Error('egress_entry_arguments');const service=await startInstalledCompositeEgress();let stopping=false;const stop=()=>{if(stopping)return;stopping=true;void service.close().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});};process.once('SIGTERM',stop);process.once('SIGINT',stop);}
void main().catch(error=>{process.stderr.write(String(error)+'\n');process.exitCode=1;});
