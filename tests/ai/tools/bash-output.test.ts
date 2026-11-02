import {expect,it} from 'vitest';
import {BoundedShellOutput,WindowsElevationDetector} from '../../../src/ai/tools/bash-output.js';
it('decodes split UTF8 and accounts exact omitted bytes',()=>{
 const capture=new BoundedShellOutput(40);const bytes=Buffer.from('首😀'+'.'.repeat(200)+'尾😀');
 for(const byte of bytes)capture.write(Buffer.from([byte]));capture.end();
 const result=capture.render(100);
 expect(result).toContain('首😀');expect(result).toContain('尾😀');expect(result).not.toContain('\uFFFD');
 expect(result).toContain(`totalBytes=${bytes.length}`);expect(result.length).toBeLessThanOrEqual(100);
});
it('bounds retained data independently of total emitted bytes',()=>{
 const capture=new BoundedShellOutput(1024);for(let i=0;i<1000;i++)capture.write(Buffer.alloc(8192,120));capture.end();
 expect(capture.retainedBytes).toBeLessThanOrEqual(1024);expect(capture.totalBytes).toBe(8192000);
 expect(capture.render(512)).toContain('omittedBytes=');
});
it('detects elevation in middle and across chunks including long whitespace',()=>{
 const detector=new WindowsElevationDetector();
 expect(detector.write('x'.repeat(100000)+' adminis')).toBe(false);
 expect(detector.write('trator'+' '.repeat(100000))).toBe(false);
 expect(detector.write('permissions are required'+'x'.repeat(100000))).toBe(true);
});
it('accounts malformed bytes from original spans and avoids surrogate fragments',()=>{
 const capture=new BoundedShellOutput(40);capture.write(Buffer.from([0xff]));capture.write(Buffer.alloc(200,120));capture.end();
 const result=capture.render(100);const omitted=Number(result.match(/omittedBytes=(\d+)/)?.[1]);
 const [head,tail]=result.split(/\n\[truncated[^\n]*\]\n/);
 expect(omitted).toBe(201-(Buffer.byteLength(head)-2)-Buffer.byteLength(tail));
 const unicode=new BoundedShellOutput(11);unicode.write(Buffer.from('😀'.repeat(100)));unicode.end();
 expect(unicode.render(100)).not.toContain('\uFFFD');
});
