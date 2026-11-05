import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { writeFileSync, mkdirSync, rmSync, chmodSync, mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { pathToFileURL } from 'url';
import { spawnSync } from 'child_process';
import { grepTool, grepTruncationNotice, runFallbackGrepSearch } from '../../../src/ai/tools/grep.js';
import { createBoundedGlobRunner } from '../../../src/ai/tools/bounded-glob.js';

vi.mock('child_process',async importOriginal=>{
  const actual=await importOriginal<typeof import('child_process')>();
  return {...actual,spawnSync:vi.fn(actual.spawnSync)};
});

describe('grepTool', () => {
  let dir: string;
  beforeEach(() => {
    dir = join(tmpdir(), `xiaok-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.txt'), 'hello world\nfoo bar\nhello again');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('finds matching lines', async () => {
    const result = await grepTool.execute({ pattern: 'hello', path: dir });
    expect(result).toContain('hello world');
    expect(result).toContain('hello again');
    expect(result).not.toContain('foo bar');
  });

  it('returns empty message when no matches', async () => {
    const result = await grepTool.execute({ pattern: 'zzznomatch', path: dir });
    expect(result).toContain('无匹配');
  });

  it('supports the pure node fallback when external grep commands are unavailable', async () => {
    const result = await runFallbackGrepSearch({ pattern: 'hello', path: dir });
    expect(result.some((line) => line.includes('hello world'))).toBe(true);
    expect(result.some((line) => line.includes('hello again'))).toBe(true);
  });
});


// #135 B1: the worker-based Node fallback (also used without a sandbox when
// rg/grep are missing, e.g. Windows) must keep master's tolerance: skip what it
// cannot read and truncate at limits instead of failing the whole search.
const roots:string[]=[];
afterEach(()=>{
  for(const root of roots.splice(0)){
    try{chmodSync(join(root,'locked'),0o755);}catch{/* not every test locks */}
    try{chmodSync(join(root,'locked.txt'),0o644);}catch{/* not every test locks */}
    rmSync(root,{recursive:true,force:true,maxRetries:3});
  }
});
function dir(){const root=mkdtempSync(join(tmpdir(),'xiaok-grep-limits-'));roots.push(root);
  writeFileSync(join(root,'ok.txt'),'hello visible\n');return root;}
function bare(){const root=mkdtempSync(join(tmpdir(),'xiaok-grep-limits-'));roots.push(root);return root;}
const canLock=process.platform!=='win32'&&process.getuid?.()!==0;
const grep=(cwd:string,limits={})=>createBoundedGlobRunner({limits}).grep(
  {cwd,patterns:'**/*',dot:true,skipInaccessible:true,grep:{pattern:'hello',context:0,outputMode:'lines'}});

describe('grep fallback keeps partial results like master',()=>{
  it.skipIf(!canLock)('skips an unreadable directory instead of failing the search',async()=>{
    const root=dir();mkdirSync(join(root,'locked'));writeFileSync(join(root,'locked','x.txt'),'hello hidden');
    chmodSync(join(root,'locked'),0);
    const lines=await runFallbackGrepSearch({pattern:'hello',path:root});
    expect(lines.some(line=>line.includes('hello visible'))).toBe(true);
    // Skipping what master skipped is not a truncation, so no notice.
    expect(lines.truncated).toEqual([]);
  });
  it.skipIf(!canLock)('skips an unreadable file inside a directory walk',async()=>{
    const root=dir();writeFileSync(join(root,'locked.txt'),'hello hidden');chmodSync(join(root,'locked.txt'),0);
    const lines=await runFallbackGrepSearch({pattern:'hello',path:root});
    expect(lines.some(line=>line.includes('hello visible'))).toBe(true);
    expect(lines.some(line=>line.includes('hello hidden'))).toBe(false);
  });
  it.skipIf(!canLock)('still fails when the one file the user named explicitly cannot be read',async()=>{
    const root=dir();const file=join(root,'named.txt');writeFileSync(file,'hello hidden');chmodSync(file,0);
    await expect(runFallbackGrepSearch({pattern:'hello',path:file})).rejects.toThrow(/grep_read_failed/);
  });
  it('skips a file over 8MB and reports it instead of grep_read_limit',async()=>{
    const root=dir();writeFileSync(join(root,'big.bin'),Buffer.alloc(8*1024*1024+1,97));
    const result=await grep(root);
    expect(result.map(entry=>entry.text)).toEqual(['hello visible']);
    expect(result.truncated).toEqual(['file_too_large']);
  });
  it('stops at the 16MB cumulative read budget and returns what it already found',async()=>{
    const root=dir();
    for(let i=0;i<3;i++)writeFileSync(join(root,`part-${i}.txt`),`hello part ${i}\n`+'x'.repeat(7*1024*1024));
    const result=await grep(root);
    // Two 7MB files fit in 16MB, the third does not: exactly two parts, each found once.
    const parts=result.filter(entry=>entry.path.includes('part-')).map(entry=>entry.text);
    expect(parts).toHaveLength(2);expect(new Set(parts).size).toBe(2);
    for(const text of parts)expect(text).toMatch(/^hello part [0-2]$/);
    expect(result.truncated).toEqual(['read_budget']);
  });
  it('truncates at the result limit instead of throwing grep_result_limit',async()=>{
    const root=dir();writeFileSync(join(root,'many.txt'),Array.from({length:50},(_,i)=>`hello ${i}`).join('\n'));
    const result=await grep(root,{maxResults:10});
    expect(result).toHaveLength(10);expect(result.truncated).toEqual(['result_limit']);
    // What is kept is the leading run of matches, in file order, not an arbitrary subset.
    const kept=result.filter(entry=>entry.path.endsWith('many.txt'));
    expect(kept.map(entry=>entry.text)).toEqual(kept.map((_,i)=>`hello ${i}`));
    expect(kept.map(entry=>entry.lineNo)).toEqual(kept.map((_,i)=>i+1));
  });
  it('truncates at the 1MB matched-text budget instead of throwing grep_result_limit',async()=>{
    const root=dir();const line='hello '+'y'.repeat(400*1024);
    writeFileSync(join(root,'wide.txt'),[line,line,line].join('\n'));
    const result=await grep(root);
    expect(result.filter(entry=>entry.path.endsWith('wide.txt')).map(entry=>entry.lineNo)).toEqual([1,2]);
    expect(result.truncated).toEqual(['result_limit']);
  });
  it('caps context lines at the result limit and keeps them in order',async()=>{
    const root=bare();writeFileSync(join(root,'ctx.txt'),['hello a','ctx 1','hello b','ctx 2','hello c','ctx 3'].join('\n'));
    const result=await createBoundedGlobRunner({limits:{maxResults:4}}).grep(
      {cwd:root,patterns:'**/*',dot:true,skipInaccessible:true,grep:{pattern:'hello',context:1,outputMode:'lines'}});
    expect(result.map(entry=>[entry.lineNo,entry.text])).toEqual([[1,'hello a'],[2,'ctx 1'],[3,'hello b'],[4,'ctx 2']]);
    expect(result.truncated).toEqual(['result_limit']);
  });
  it('truncates at the path-bytes budget instead of throwing',async()=>{
    const root=bare();writeFileSync(join(root,'p.txt'),Array.from({length:5},(_,i)=>`hello ${i}`).join('\n'));
    const input={cwd:root,patterns:'**/*',dot:true,skipInaccessible:true,grep:{pattern:'hello',context:0,outputMode:'lines' as const}};
    const all=await createBoundedGlobRunner().grep(input);
    expect(all).toHaveLength(5);expect(all.truncated).toEqual([]);
    const pathBytes=Buffer.byteLength(all[0]!.path);
    const result=await createBoundedGlobRunner({limits:{maxPathBytes:pathBytes*3}}).grep(input);
    expect(result.map(entry=>entry.text)).toEqual(['hello 0','hello 1','hello 2']);
    expect(result.truncated).toEqual(['result_limit']);
  });
  it('rejects a worker that forges truncation reasons, including holes in a sparse array',async()=>{
    const root=bare();
    for(const [name,forged] of [['sparse','new Array(1)'],['unknown',"['made_up']"],['oversized',"['result_limit','result_limit','result_limit','result_limit']"]] as const){
      const script=join(root,`${name}-worker.mjs`);
      writeFileSync(script,`import {parentPort} from 'node:worker_threads';parentPort.postMessage({ok:true,entries:[],truncated:${forged}});`);
      await expect(createBoundedGlobRunner({workerUrl:pathToFileURL(script)}).grep(
        {cwd:root,patterns:'**/*',grep:{pattern:'hello',context:0,outputMode:'lines'}}),name).rejects.toThrow('glob_worker_failed');
    }
  });
  it('shows the truncation notice through the non-sandbox tool entry when rg and grep are missing',async()=>{
    const root=dir();writeFileSync(join(root,'big.bin'),Buffer.alloc(8*1024*1024+1,97));
    vi.mocked(spawnSync).mockImplementation((()=>({status:null,error:new Error('ENOENT')})) as never);
    try{
      const result=await grepTool.execute({pattern:'hello',path:root});
      expect(result).toContain('hello visible');expect(result).toMatch(/搜索已截断：跳过了超过 8MB 的文件/);
      const empty=bare();writeFileSync(join(empty,'big.bin'),Buffer.alloc(8*1024*1024+1,97));
      const none=await grepTool.execute({pattern:'hello',path:empty});
      expect(none).toMatch(/^（搜索已截断：跳过了超过 8MB 的文件）$/);expect(none).not.toContain('无匹配');
      expect(vi.mocked(spawnSync)).toHaveBeenCalled();
    }finally{vi.mocked(spawnSync).mockReset();vi.mocked(spawnSync).mockImplementation((await vi.importActual<typeof import('child_process')>('child_process')).spawnSync);}
  });
  it('turns every truncation reason into a visible notice and none into nothing',()=>{
    expect(grepTruncationNotice([])).toBe('');
    expect(grepTruncationNotice(['result_limit','file_too_large','read_budget'])).toMatch(/搜索已截断.*上限.*8MB.*16MB/);
  });
});
