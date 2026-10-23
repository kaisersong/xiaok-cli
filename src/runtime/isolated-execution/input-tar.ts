/** Builds controller-owned archive bytes; never passes a project supplied TAR to the engine. */
export function buildInputFileArchive(input:{path:string;bytes:Buffer;executable:boolean}):Buffer{
 const path=input.path,bytes=Buffer.from(input.bytes),executable=input.executable;
 if(typeof path!=='string'||!path||Buffer.byteLength(path)>4096||path.includes('\\')||path.split('/').some(p=>!p||p==='.'||p==='..'||/[:\x00-\x1f\x7f]/.test(p))||path.split('/').length>64||bytes.length>16*1024**2||typeof executable!=='boolean')throw Error('input_archive_scope');
 const blocks:Buffer[]=[];
 function octal(header:Buffer,at:number,size:number,value:number){const text=value.toString(8);if(text.length>=size)throw Error('input_archive_number');header.write(text.padStart(size-1,'0')+'\0',at,size,'ascii');}
 function record(name:string,type:string,data:Buffer,mode:number){
  const h=Buffer.alloc(512);h.write(name,0,100,'utf8');octal(h,100,8,mode);octal(h,108,8,10000);octal(h,116,8,10000);octal(h,124,12,data.length);octal(h,136,12,0);h.fill(32,148,156);h.write(type,156);h.write('ustar\0',257);h.write('00',263);const sum=h.reduce((a,b)=>a+b,0);h.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');blocks.push(h,data,Buffer.alloc((512-data.length%512)%512));
 }
 function entry(name:string,type:string,data:Buffer,mode:number){
  const payload='path='+name+'\n';let length=Buffer.byteLength(payload)+2;while(Buffer.byteLength(payload)+String(length).length+1!==length)length=Buffer.byteLength(payload)+String(length).length+1;
  record('PaxHeader','x',Buffer.from(length+' '+payload),0o444);record('entry',type,data,mode);
 }
 const parts=path.split('/');for(let i=1;i<parts.length;i++)entry(parts.slice(0,i).join('/')+'/','5',Buffer.alloc(0),0o755);
 entry(path,'0',bytes,executable?0o555:0o444);blocks.push(Buffer.alloc(1024));return Buffer.concat(blocks);
}
