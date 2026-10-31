/** Read-only production-discovery measurement; no product registration changes. */
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { ToolRegistry } from '../../../src/ai/tools/index.js';
import { CapabilityRegistry } from '../../../src/platform/runtime/capability-registry.js';
import { loadSkills } from '../../../src/ai/skills/loader.js';
import { createSkillTool } from '../../../src/ai/skills/tool.js';
const args = process.argv.slice(2);
const arg = (key: string) => { const i = args.indexOf(key); if (i < 0) throw new Error(`missing ${key}`); return resolve(args[i + 1]); };
const output = arg('--output'); if (existsSync(output)) throw new Error('fresh output required');
mkdirSync(output, { recursive: true, mode: 0o700 });
const plugins = arg('--plugins');
const roots = ['kai-report-creator','kai-slide-creator','kai-meeting-assistant','cua-computer-use','kai-infinity-canvas'].map(p => join(plugins,'plugins',p,'skills'));
const skills = await loadSkills(join(output,'empty-config'), output, { builtinRoots: roots });
const capabilities = new CapabilityRegistry();
const registry = new ToolRegistry({ autoMode: true, capabilityRegistry: capabilities });
registry.registerTool(createSkillTool(skills, capabilities));
const corpus = registry.searchTools('');
const cases = [
  ['R01','cd xiaok-cli',['bash'],'user-session'],
  ['R02','看一下2026-10-01-jev-skill-hybrid-architecture-design.md文档',['read'],'user-session'],
  ['R03','给xiaok-cli和kai-slide-creator都开一个worktree',['bash'],'user-session'],
  ['R04','从x上搜索jev应用的热点场景',['web_search'],'user-session'],
  ['S01','select:read',['read'],'synthetic'],
  ['S02','select:web_search',['web_search'],'synthetic'],
  ['S03','select:slide-planner',['slide-planner'],'synthetic'],
  ['S04','select:kai-report-creator',['kai-report-creator'],'synthetic'],
  ['S05','slide',['slide-planner'],'synthetic'],
  ['S06','report',['kai-report-creator'],'synthetic'],
  ['S07','meeting',['meeting-summarizer'],'synthetic'],
  ['S08','canvas',['canvas-open','canvas-insert','canvas-edit','canvas-annotate','canvas-image-gen'],'synthetic'],
  ['S09','读取本地文本文件',['read'],'synthetic'],
  ['S10','联网搜索近期新闻',['web_search'],'synthetic'],
  ['S11','根据资料生成演示文稿',['slide-planner'],'synthetic'],
  ['S12','将会议逐字稿整理为纪要',['meeting-summarizer'],'synthetic'],
  ['S13','创建商务HTML报告',['kai-report-creator'],'synthetic'],
  ['S14','只解释什么是闭包，不要执行操作',[],'synthetic'],
  ['S15','通过系统API调用卫星拍照',[],'synthetic'],
  ['S16','不要生成幻灯片，只搜索网页资料',['web_search'],'synthetic'],
  ['S17','用正则表达式查找文件内容',['grep'],'synthetic'],
  ['S18','查找所有符合文件名模式的文件',['glob'],'synthetic'],
  ['S19','安装一个新的技能',['install_skill'],'synthetic'],
  ['S20','打开无穷画布并给图片加注释',['canvas-open','canvas-annotate'],'synthetic'],
] as const;
const records = [];
for (const [id,query,gold,origin] of cases) {
  const at = performance.now(); const text = await registry.executeTool('tool_search',{query});
  const definitions = JSON.parse(text); if (!Array.isArray(definitions)) throw new Error('discovery returned non-array');
  const names: string[] = definitions.map((d: any) => d.name);
  records.push({id,query,gold,origin,names,wallMs:performance.now()-at,payloadBytes:Buffer.byteLength(text),hit:gold.length ? gold.every(n=>names.includes(n)) : names.length===0});
}
const save=(name:string,value:unknown)=>writeFileSync(join(output,name),JSON.stringify(value,null,2),{mode:0o600});
save('corpus.json',corpus); save('cases.json',records);
save('baseline.json',{at:new Date().toISOString(),scope:'production loader + registry + tool_search on authentic public plugin/core corpus; replay corpus, not mounted Desktop registry or traffic survey',corpusHash:createHash('sha256').update(JSON.stringify(corpus)).digest('hex'),corpusCount:corpus.length,skills:skills.map(s=>s.name),records,structuredHistoricalToolSearchCallsFound:0, gold:'same-author frozen immediate-capability labels; four current-user-session requests, twenty synthetic probes'});
console.log(JSON.stringify({corpusCount:corpus.length,skills:skills.map(s=>s.name),records}));
registry.dispose();
