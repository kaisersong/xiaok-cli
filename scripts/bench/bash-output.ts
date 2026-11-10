import {createBashTool} from '../../src/ai/tools/bash.js';
import {monitorEventLoopDelay} from 'node:perf_hooks';
const mb=Number(process.argv[2]??32);let events=0;let peak=process.memoryUsage().rss;
const timer=setInterval(()=>{peak=Math.max(peak,process.memoryUsage().rss);},5);
const loop=monitorEventLoopDelay({resolution:10});loop.enable();const start=performance.now();
const command=`"${process.execPath}" -e "process.stdout.write('HEAD');for(let i=0;i<${mb*16};i++)process.stdout.write('.'.repeat(65536));process.stdout.write('TAIL');process.exitCode=7"`;
const result=await createBashTool().execute({command,max_chars:12000,timeout_ms:30000},{executionProgress:{progress(){events++;},wait(){},resume(){}}});
clearInterval(timer);loop.disable();peak=Math.max(peak,process.memoryUsage().rss);
console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,mb,elapsedMs:performance.now()-start,peakRss:peak,events,eventLoopMaxMs:loop.max/1e6,resultChars:result.length,hasTail:result.includes('TAIL'),failed:result.startsWith('Error'),backgroundProcesses:0}));
