const fs=require('node:fs'),path=require('node:path');
const root=process.env.CONTROL_CONFIG_ROOT,held=(process.env.CONFIG_HOLD_TYPES||'').split(','),mode=process.env.CONFIG_SDK_MODE||'callback',send=process.send?.bind(process),NativePromise=Promise;
const mark=(name,value)=>{const file=path.join(root,name),temp=file+'.pending';fs.writeFileSync(temp,JSON.stringify(value),{mode:0o600});fs.renameSync(temp,file);};
if(root&&send)process.send=function(frame,callback){
 if(frame?.protocol!=='activity_desktop_config_v1'||!held.includes(frame.type))return send(frame,callback);
 const label=frame.type+'-'+(frame.offerId||0);let release,rawRelease,released=false,rawReleased=mode!=='raw';
 const result=send(frame,error=>{release=()=>callback(mode==='error'?Error('original authenticated SDK callback failure'):error);mark('held-'+label+'.json',{pid:process.pid,type:frame.type,id:frame.offerId||0});});
 const timer=setInterval(()=>{if(!released&&release&&fs.existsSync(path.join(root,'release-'+label))){released=true;mark('released-'+label+'.json',{pid:process.pid});release();}if(!rawReleased&&rawRelease&&fs.existsSync(path.join(root,'release-raw-'+label))){rawReleased=true;rawRelease();}if(released&&rawReleased)clearInterval(timer);},5);
 if(mode==='raw')return new NativePromise(yes=>{rawRelease=yes;});
 if(mode==='thenable')return {get then(){mark('forbidden-sdk-then.json',{pid:process.pid});throw Error('unknown SDK getter executed');}};
 if(mode==='throw')throw Error('original authenticated SDK threw after real send');
 return result;
};
