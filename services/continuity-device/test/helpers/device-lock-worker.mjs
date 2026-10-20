import {claimDeviceNamespace} from '../../src/device-lock.mjs';
let owner;
process.on('message',async message=>{
 try{
  if(message.type==='open'){owner=claimDeviceNamespace(message.options);process.send({type:'open',ok:true,pid:process.pid});}
  if(message.type==='uncertain'){
   class Early extends Promise{then(resolve){resolve('early');}}
   const raw=message.variant==='subclass'?new Early(()=>{}):message.variant==='hidden-proxy'?Object.create(new Proxy({},{has:()=>false,get:(_target,key)=>key==='then'?()=>{}:undefined})):message.proxy?new Proxy({},{has:()=>false}):{then(){}};
   const work=owner.run(()=>raw);work.then(()=>process.send({type:'uncertain',denied:false}),()=>process.send({type:'uncertain',denied:true}));owner.close();void owner.drainClosed().then(()=>process.send({type:'released',denied:false}));
  }
  if(message.type==='close'){owner?.close();await owner?.drainClosed();process.send({type:'closed',ok:true},()=>process.disconnect());}
 }catch{process.send({type:message.type,ok:false,error:'device_owner_unavailable'});if(message.type==='open')process.disconnect();}
});
