// Real test-only loopback requests. No injected transport or authority callback.
'use strict';
const {request}=require('node:http'),assert=require('node:assert/strict');
exports.readRoomProtocol=async function readRoomProtocol(port,token,route='/rooms/workspace-protocol'){
 assert.ok(Number.isInteger(port)&&port>0&&port<=65535);assert.ok(route==='/rooms/workspace-protocol'||route==='/room-wakes?logicalAgentId=fixture-observer');
 let first,bytes=0,chunks=[],status,complete=false,responseStarted=false,req,socket,resolveResponse,resolveRequest,resolveSocket;
 const responseDone=new Promise(yes=>{resolveResponse=yes;}),requestDone=new Promise(yes=>{resolveRequest=yes;}),socketDone=new Promise(yes=>{resolveSocket=yes;});
 const fail=raw=>{first??={raw};};
 try{
  req=request({hostname:'127.0.0.1',port,path:route,method:'GET',agent:false,headers:token===undefined?{}:{'x-intent-broker-room-token':token}},response=>{
   responseStarted=true;status=response.statusCode;response.on('data',chunk=>{bytes+=chunk.length;if(bytes>65536){fail(Error('FIXTURE_ROOM_BODY_TOO_LARGE'));response.destroy();}else chunks.push(chunk);});
   response.once('end',()=>{complete=true;});response.once('error',fail);response.once('close',resolveResponse);
  });
  req.once('error',raw=>{fail(raw);resolveResponse();if(!socket)resolveSocket();});req.once('close',()=>{resolveRequest();if(!responseStarted)resolveResponse();if(!socket)resolveSocket();});
  req.once('socket',value=>{socket=value;value.once('error',fail);value.once('close',resolveSocket);});req.end();
 }catch(raw){fail(raw);if(req){try{req.destroy();}catch(secondary){fail(secondary);}}else{resolveRequest();resolveResponse();resolveSocket();}}
 await Promise.all([responseDone,requestDone,socketDone]);
 if(first)throw first.raw;if(!complete)throw Error('FIXTURE_ROOM_BODY_INCOMPLETE');
 return {status,body:JSON.parse(Buffer.concat(chunks,bytes).toString('utf8')),complete,requestClosed:true,socketClosed:true};
};
