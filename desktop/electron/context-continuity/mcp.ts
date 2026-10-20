import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { McpServer, WebStandardStreamableHTTPServerTransport, type StandardSchemaWithJSON } from '@modelcontextprotocol/server';
import { localhostHostValidation, localhostOriginValidation, toWebRequest } from '@modelcontextprotocol/node';
import { z } from 'zod/v4';
import type { ContinuityService } from './service.js';
import type { ResolveContextReferenceInput,ContextReferencePage } from '../../shared/context-continuity-types.js';

const validateHost=localhostHostValidation(),validateOrigin=localhostOriginValidation();
const MAX_REQUEST=16384,MAX_RESPONSE=65536;
async function untilAbort<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
  if(signal.aborted)throw new Error('request_aborted');
  let abort!:()=>void;
  const interrupted=new Promise<never>((_,reject)=>{abort=()=>reject(new Error('request_aborted'));signal.addEventListener('abort',abort,{once:true});});
  try{return await Promise.race([pending,interrupted]);}finally{signal.removeEventListener('abort',abort);}
}
const validation=z.object({refId:z.string().regex(/^[A-Za-z0-9_-]{32}$/),cursor:z.string().max(2048).optional(),limit:z.number().int().min(1).max(100).optional()}).strict();
// Existing Zod provides Standard Schema validation; expose its official JSON Schema conversion explicitly.
const schema:StandardSchemaWithJSON<ResolveContextReferenceInput>={'~standard':{...validation['~standard'],jsonSchema:{input:()=>z.toJSONSchema(validation),output:()=>z.toJSONSchema(validation)}}};
/** Main owns one loopback listener. Each authenticated HTTP request has a fresh stateless MCP server. */
export class ContinuityMcpEndpoint {
  private server:Server|null=null;
  private starting:Promise<string>|null=null;
  private address:string|null=null;
  private stopping=false;
  private requests=new Set<AbortController>();
  private handlers=new Set<Promise<void>>();
  constructor(private readonly options:{service:ContinuityService;refresh?:()=>Promise<void>}){}
  get activeRequests():number{return this.requests.size;}
  start(port:number):Promise<string>{
    if(this.stopping)return Promise.reject(new Error('continuity_stopping'));
    if(this.address)return Promise.resolve(this.address);if(this.starting)return this.starting;
    if(!Number.isSafeInteger(port)||port<0||port>65535)return Promise.reject(new Error('invalid_argument'));
    const server=createServer((req,res)=>{const pending=this.handle(req,res).catch(()=>{this.reply(res,500,'request_failed');});this.handlers.add(pending);void pending.finally(()=>this.handlers.delete(pending));});
    server.requestTimeout=15000;server.headersTimeout=10000;server.maxHeadersCount=32;
    this.server=server;
    this.starting=new Promise<string>((resolve,reject)=>{
      server.once('error',reject);server.listen(port,'127.0.0.1',()=>{server.removeListener('error',reject);const address=server.address();
        if(!address||typeof address==='string'){reject(new Error('endpoint_unavailable'));return;}
        this.address=`http://127.0.0.1:${address.port}/mcp`;resolve(this.address);
      });
    }).finally(()=>{this.starting=null;});return this.starting;
  }
  private reply(res:ServerResponse,status:number,code:string):void{
    if(res.destroyed||res.writableEnded)return;
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify({error:code}));
  }
  private async handle(req:IncomingMessage,res:ServerResponse):Promise<void>{
    if(req.url!=='/mcp'){this.reply(res,404,'not_found');return;}
    if(!validateHost(req,res)||!validateOrigin(req,res))return;
    const bearer=req.headers.authorization;
    if(typeof bearer!=='string'||!/^Bearer [A-Za-z0-9_-]{43}$/.test(bearer)||req.rawHeaders.filter((_,i)=>i%2===0&&req.rawHeaders[i].toLowerCase()==='authorization').length!==1){this.reply(res,401,'not_authorized');return;}
    let principal;
    try{principal=this.options.service.authenticateExternalReader(bearer.slice(7));}catch{this.reply(res,401,'not_authorized');return;}
    if(req.method!=='POST'){this.reply(res,405,'method_not_allowed');return;}
    if(this.stopping||this.requests.size>=4){this.reply(res,503,'temporarily_unavailable');return;}
    if(Number(req.headers['content-length']??0)>MAX_REQUEST){this.reply(res,413,'request_too_large');return;}
    const controller=new AbortController();this.requests.add(controller);
    const abort=()=>controller.abort();req.once('aborted',abort);const close=()=>{if(!res.writableEnded)abort();};res.once('close',close);
    const timer=setTimeout(()=>{controller.abort();this.reply(res,408,'request_timeout');req.destroy();},15000);
    const server=new McpServer({name:'xiaok-context',version:'1.0.0'});
    const transport=new WebStandardStreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true,maxRequestBodySize:MAX_REQUEST});
    const closeTransport=()=>{void transport.close().catch(()=>undefined);};controller.signal.addEventListener('abort',closeTransport,{once:true});
    let status=500,body=Buffer.from('{"error":"request_failed"}');
    const pages=new Set<ContextReferencePage>();
    try{
      server.registerTool('resolve_context_reference',{description:'Read the exact public messages of an explicitly authorized xiaok reference. Archived evidence with unknown execution is not proof of completed work.',inputSchema:schema,annotations:{readOnlyHint:true,destructiveHint:false,openWorldHint:false}},input=>{
        try{this.options.service.assertExternalReader(principal);const page=this.options.service.resolveExternalReference(principal,input),encoded=JSON.stringify(page);
          this.options.service.assertExternalReferenceCurrent(page,principal,input);pages.add(page);return {content:[{type:'text' as const,text:encoded}]};}
        catch{return {isError:true,content:[{type:'text' as const,text:'context_not_readable'}]};}
      });
      await untilAbort(this.options.refresh?.()??Promise.resolve(),controller.signal);this.options.service.assertExternalReader(principal);
      await server.connect(transport);
      const request=await toWebRequest(req,undefined,{signal:controller.signal,maxRequestBodySize:MAX_REQUEST});
      const response=await transport.handleRequest(request);status=response.status;
      const chunks:Uint8Array[]=[];let length=0;
      if(response.body){const reader=response.body.getReader();try{for(;;){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>MAX_RESPONSE)throw new Error('response_too_large');chunks.push(part.value);}}finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}}
      body=Buffer.concat(chunks);
    }catch(error){status=(error as {status?:number}).status===413?413:controller.signal.aborted?408:500;body=Buffer.from('{"error":"request_failed"}');}
    finally{
      clearTimeout(timer);req.removeListener('aborted',abort);res.removeListener('close',close);controller.signal.removeEventListener('abort',closeTransport);
      await server.close().catch(()=>undefined);await transport.close().catch(()=>undefined);this.requests.delete(controller);
    }
    // Buffer only a bounded JSON response; revalidate after every async SDK step and before any body leaves main.
    if(controller.signal.aborted||res.destroyed||res.writableEnded)return;
    try{this.options.service.assertExternalReader(principal);for(const page of pages)this.options.service.assertExternalReferenceCurrent(page,principal);}catch{this.reply(res,401,'not_authorized');return;}
    res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(body);
  }
  async close():Promise<void>{
    this.stopping=true;await this.starting?.catch(()=>undefined);for(const request of this.requests)request.abort();
    const server=this.server;this.server=null;this.address=null;if(!server)return;
    await new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();});
    await Promise.allSettled([...this.handlers]);
  }
}
