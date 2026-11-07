import {StringDecoder} from 'node:string_decoder';
// Omit partial boundary codepoints; malformed input within a retained span is
// displayed with replacement characters, but byte accounting uses original bytes.
function prefixBytes(bytes:Buffer,limit:number):Buffer {
  let end=Math.min(bytes.length,Math.max(0,limit));
  let start=end-1;
  while(start>=0 && (bytes[start]&0xc0)===0x80)start--;
  if(start>=0){const lead=bytes[start];const width=lead>=0xf0&&lead<=0xf4?4:lead>=0xe0&&lead<=0xef?3:lead>=0xc2&&lead<=0xdf?2:1;
    if(start+width>end)end=start;}
  return bytes.subarray(0,end);
}
function suffixBytes(bytes:Buffer,limit:number):Buffer {
  let start=Math.max(0,bytes.length-limit);
  while(start<bytes.length && (bytes[start]&0xc0)===0x80)start++;
  return bytes.subarray(start);
}
/** Bounded original byte windows; decoded original chunks go to the existing collector. */
export class BoundedShellOutput {
  private decoder=new StringDecoder('utf8');
  private head:Buffer=Buffer.alloc(0);private tail:Buffer=Buffer.alloc(0);
  totalBytes=0;
  constructor(private readonly limit:number) {}
  get retainedBytes():number {return this.head.length+this.tail.length;}
  write(bytes:Buffer):string {
    this.totalBytes+=bytes.length;
    const needed=Math.max(0,Math.floor(this.limit/2)-this.head.length);
    if(needed)this.head=Buffer.concat([this.head,bytes.subarray(0,needed)]);
    const rest=bytes.subarray(Math.min(bytes.length,needed));
    // Copy the small retained window: a subarray must not retain a huge source buffer.
    const tail=Buffer.concat([this.tail,rest]);this.tail=Buffer.from(tail.subarray(Math.max(0,tail.length-(this.limit-this.head.length))));
    return this.decoder.write(bytes);
  }
  end():string {return this.decoder.end();}
  render(budget:number):string {
    if(this.totalBytes===this.retainedBytes){
      const full=Buffer.concat([this.head,this.tail]).toString('utf8');
      if(full.length<=budget)return full;
    }
    const metadata=`\n[truncated; totalBytes=${this.totalBytes}; omittedBytes=${this.totalBytes}]\n`;
    const available=Math.max(0,budget-metadata.length);
    const head=prefixBytes(this.head,Math.floor(available/2));const tail=suffixBytes(this.tail,available-head.length);
    const omitted=this.totalBytes-head.length-tail.length;
    return `${head.toString('utf8')}\n[truncated; totalBytes=${this.totalBytes}; omittedBytes=${omitted}]\n${tail.toString('utf8')}`;
  }
}
/** Whitespace-normalized streaming detector: independent of presentation truncation. */
export class WindowsElevationDetector {
  private tail=''; private lastSpace=false;
  write(text:string):boolean {
    let normalized=text.replace(/\s+/g,' ');
    if(this.lastSpace && normalized.startsWith(' '))normalized=normalized.slice(1);
    if(normalized)this.lastSpace=normalized.endsWith(' ');
    const current=this.tail+normalized;
    const matched=[/需要管理员权限/i,/以管理员身份运行/i,/请手动运行/i,/requested operation requires elevation/i,
      /requires? (?:administrator|admin|elevat)/i,
      /(?:administrator|admin|elevat) (?:privileges|rights|permissions?) (?:are )?required/i,
      /run (?:manually )?as administrator/i].some(pattern=>pattern.test(current));
    this.tail=current.slice(-128);return matched;
  }
}
export function renderShellOutput(stdout:BoundedShellOutput,stderr:BoundedShellOutput,budget:number):string {
  const streams=([['stdout',stdout],['stderr',stderr]] as const).filter(([,value])=>value.totalBytes>0);
  if(!streams.length)return '（无输出）';
  if(streams.length===1 && streams[0][0]==='stdout' && stdout.totalBytes<=budget)return stdout.render(budget).trim();
  const perStream=Math.floor((budget-streams.length*10)/streams.length);
  return streams.map(([name,value])=>`[${name}]\n${value.render(perStream)}`).join('\n');
}
