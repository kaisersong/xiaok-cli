/** Exact formatting only. These public numbers/strings never authenticate a
 * budget owner, unit enrollment, headroom, Source proof or spending permit. */
const integer=Number.isSafeInteger,is=Object.is,NativeBigInt=BigInt,NativeNumber=Number,NativeError=Error;
const apply=Reflect.apply,exec=RegExp.prototype.exec,bigintString=BigInt.prototype.toString,slice=String.prototype.slice;
const amount=/^(0|[1-9][0-9]*)(?:\.([0-9]{1,6}))?$/;
const unit=1000000n,maximum=NativeBigInt(Number.MAX_SAFE_INTEGER);
function invalid():never{throw new NativeError('DSH_USD_AMOUNT_INVALID');}
/** Canonical dollar text -> exact integer microUSD, never binary dollar math. */
export function parseDshUsdAmount(input:unknown):number {
 if(typeof input!=='string'||input.length===0||input.length>32)invalid();
 const match=apply(exec,amount,[input]) as RegExpExecArray|null;if(!match)invalid();
 const fraction=match[2]??'';let padded=fraction;for(let i=fraction.length;i<6;i++)padded+='0';
 const micros=NativeBigInt(match[1]!)*unit+NativeBigInt(padded);
 if(micros>maximum)invalid();return NativeNumber(micros);
}
/** Integer microUSD -> exact canonical dollar text. Zero stays zero. */
export function formatDshUsdAmount(input:unknown):string {
 if(typeof input!=='number'||!integer(input)||input<0||is(input,-0))invalid();
 const value=NativeBigInt(input),whole=apply(bigintString,value/unit,[]) as string,remainder=value%unit;
 if(remainder===0n)return whole;
 const raw=apply(bigintString,remainder,[]) as string;let digits=raw;for(let i=raw.length;i<6;i++)digits='0'+digits;
 let end=digits.length;while(digits[end-1]==='0')end--;return whole+'.'+apply(slice,digits,[0,end]);
}
