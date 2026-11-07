import {describe,it,expect} from 'vitest';
const modulePath='../../../src/runtime/admission/money.js';
const money:Record<string,any>=await import(/* @vite-ignore */ modulePath).catch(error=>{if(String(error?.code).includes('MODULE_NOT_FOUND')||String(error?.message).includes('Cannot find module'))return {};throw error;});
function parse(value:unknown){expect(money.parseDshUsdAmount).toBeTypeOf('function');return money.parseDshUsdAmount(value);}
function format(value:unknown){expect(money.formatDshUsdAmount).toBeTypeOf('function');return money.formatDshUsdAmount(value);}
describe('explicit DSH USD/microUSD integer formatting; pure data, no budget authority',()=>{
 it('exports the two actual production functions',()=>{expect(money.parseDshUsdAmount).toBeTypeOf('function');expect(money.formatDshUsdAmount).toBeTypeOf('function');});
 it.each([
  ['0',0,'0'],['0.000000',0,'0'],['0.25',250000,'0.25'],['0.000001',1,'0.000001'],['1',1000000,'1'],['1.000001',1000001,'1.000001'],['1234.560000',1234560000,'1234.56'],['9007199254.740991',Number.MAX_SAFE_INTEGER,'9007199254.740991']
 ])('converts exact golden %s without a cent multiplier', (text,micros,rendered)=>{expect(parse(text)).toBe(micros);expect(format(micros)).toBe(rendered);});
 it.each(['',' ',' 1','1 ','1e2','1E2','-1','-0','+1','01','00.1','1.',' .25','.25','0.0000001','1,000','１','1_000','9007199254.740992','9'.repeat(100000)])('refuses invalid/overflow dollar string without rounding',value=>{
  expect(money.parseDshUsdAmount).toBeTypeOf('function');expect(()=>money.parseDshUsdAmount(value)).toThrow('DSH_USD_AMOUNT_INVALID');
 });
 it.each([null,undefined,1,0.25,{},[],1n])('does not coerce non-string dollar input',value=>{expect(money.parseDshUsdAmount).toBeTypeOf('function');expect(()=>money.parseDshUsdAmount(value)).toThrow('DSH_USD_AMOUNT_INVALID');});
 it.each([-0,-1,0.25,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,undefined,1n])('does not format a non-microUSD integer',value=>{expect(money.formatDshUsdAmount).toBeTypeOf('function');expect(()=>money.formatDshUsdAmount(value)).toThrow('DSH_USD_AMOUNT_INVALID');});
 it('roundtrips representative exact ledger integers through the original formatter/parser',()=>{for(const micros of [0,1,9,10,99,100,999,1000,999999,1000000,1000001,1000000000000,Number.MAX_SAFE_INTEGER])expect(parse(format(micros))).toBe(micros);});
 it('refuses hostile input without invoking conversion hooks',()=>{let hooks=0;const raw=new Proxy({},{get(){hooks++;throw Error('not-reached');}});expect(money.parseDshUsdAmount).toBeTypeOf('function');expect(money.formatDshUsdAmount).toBeTypeOf('function');expect(()=>money.parseDshUsdAmount(raw)).toThrow('DSH_USD_AMOUNT_INVALID');expect(()=>money.formatDshUsdAmount(raw)).toThrow('DSH_USD_AMOUNT_INVALID');expect(hooks).toBe(0);});
 it.each(['1\n','1\r','1\r\n','1\u2028','1\u2029'])('requires full input consumption including final line terminators',value=>{expect(money.parseDshUsdAmount).toBeTypeOf('function');expect(()=>money.parseDshUsdAmount(value)).toThrow('DSH_USD_AMOUNT_INVALID');});
});
