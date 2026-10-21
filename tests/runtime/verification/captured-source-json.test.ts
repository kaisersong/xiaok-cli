import {expect,it} from 'vitest';
import {parseCapturedSourceJson} from '../../../src/runtime/verification/captured-source-json.js';
it('accepts a producer JSON string larger than the regexp stack without copying value tokens',()=>{
 const value={large:'x'.repeat(16*1024**2),tail:[{same:1},{same:2}]};expect(parseCapturedSourceJson(JSON.stringify(value))).toEqual(value);
});
it.each([
 '{"x":1,"\\u0078":2}',
 '{"":1,"":2}',
 '{"nested":[{"quote\\\"":1,"quote\\u0022":2}]}',
 '{"nested":{"\\\\":1,"\\u005c":2}}',
])('rejects decoded duplicate keys: %s',raw=>expect(()=>parseCapturedSourceJson(raw)).toThrow('captured_source_duplicate'));
it('allows reused keys in separate objects and ignores structural characters inside strings',()=>{
 const value={a:[{key:'[,]{}:\\"end\\'},{key:'same'}],b:{key:'again'},unicode:'🎈'};expect(parseCapturedSourceJson(JSON.stringify(value))).toEqual(value);
 expect(parseCapturedSourceJson(JSON.stringify('\\"'+','.repeat(1000)))).toBe('\\"'+','.repeat(1000));
});
it('detects a duplicate after a large value without regex recursion',()=>{
 const raw='{"x":"'+'z'.repeat(16*1024**2)+'","\\u0078":1}';expect(()=>parseCapturedSourceJson(raw)).toThrow('captured_source_duplicate');
});
it('uses explicit frames for deep arrays',()=>{const raw='['.repeat(15000)+'{"ok":1}'+']'.repeat(15000);expect(()=>parseCapturedSourceJson(raw)).not.toThrow();});
it.each(['{"x":}', '"unfinished', '[1,]', '{"x":1,}', '{"x":"\\uZZZZ"}'])('retains original syntax refusal for %s',raw=>expect(()=>parseCapturedSourceJson(raw)).toThrow(SyntaxError));
