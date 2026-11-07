const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const root=process.env.CONTROL_CONFIG_ROOT;
if(root){
 const entry=process.argv[1],name=entry?.includes('kswarm')?'kswarm':'broker';
 const birth=cp.execFileSync(process.platform==='win32'?'powershell.exe':'/bin/ps',process.platform==='win32'?['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${process.pid} -ErrorAction Stop).StartTime.ToUniversalTime().Ticks`]:['-p',String(process.pid),'-o','lstart='],{encoding:'utf8',timeout:3000}).trim();
 const file=path.join(root,`sidecar-${name}-${process.pid}.json`),temp=file+'.pending';fs.writeFileSync(temp,JSON.stringify({pid:process.pid,birth,name,entry,root}),{mode:0o600});fs.renameSync(temp,file);
 for(const key of ['stdout','stderr']){const original=process[key].write;process[key].write=function(data,...args){try{const log=path.join(root,`sidecar-${name}-${process.pid}-${key}.log`);if(!fs.existsSync(log)||fs.statSync(log).size<65536)fs.appendFileSync(log,data);}catch{}return Reflect.apply(original,this,[data,...args]);};}
}
