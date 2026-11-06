import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
// A narrow patch for npm 1.6.1. Other installed modules and config are untouched.
const entry=fs.realpathSync(process.argv[2]),root=path.dirname(path.dirname(entry));
const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
assert.equal(pkg.name,'xiaokcode');assert.equal(pkg.version,'1.6.1','仅适用于 xiaokcode 1.6.1');
const file=path.join(root,'dist','ui','render.js'),original=fs.readFileSync(file);
const sha=data=>crypto.createHash('sha256').update(data).digest('hex');
if(sha(original)==="525bf247e96eb398bc126bb53f86417d30fb59a0ecc2458f84d555079ee51ce1"){console.log('欢迎框补丁已存在。');process.exit(0);}
assert.equal(sha(original),"81e6047e0ae87157a438de2b9ee39259a28e18223f0cefedc217be9bb85abbd7",'原文件校验不符，未修改');
const edits=[
  [
    "import { getDisplayWidth, stripAnsi } from './display-width.js';",
    "import { getDisplayWidth, stripAnsi, truncateAnsi } from './text-metrics.js';"
  ],
  [
    "    const padVisible = (text, width) => {\n        const visibleWidth = getDisplayWidth(stripAnsi(text));\n        if (visibleWidth >= width)\n            return text;\n        return text + \" \".repeat(width - visibleWidth);\n    };\n    const centerVisible = (text, width) => {\n        const visibleWidth = getDisplayWidth(stripAnsi(text));\n        if (visibleWidth >= width)\n            return text;\n        const leftPad = Math.floor((width - visibleWidth) / 2);\n        const rightPad = width - visibleWidth - leftPad;\n        return \" \".repeat(leftPad) + text + \" \".repeat(rightPad);\n    };\n",
    "    const padVisible = (text, width) => {\n        const visibleWidth = getDisplayWidth(stripAnsi(text));\n        if (visibleWidth > width) {\n            const suffix = '.'.repeat(Math.min(3, width));\n            const clipped = truncateAnsi(text, width - suffix.length);\n            const reset = colorsEnabled ? '\\x1b[0m' : '';\n            return clipped + suffix + reset + ' '.repeat(width - getDisplayWidth(clipped) - suffix.length);\n        }\n        return text + \" \".repeat(width - visibleWidth);\n    };\n    const centerVisible = (text, width) => {\n        const visibleWidth = getDisplayWidth(stripAnsi(text));\n        if (visibleWidth >= width)\n            return padVisible(text, width);\n        const leftPad = Math.floor((width - visibleWidth) / 2);\n        const rightPad = width - visibleWidth - leftPad;\n        return \" \".repeat(leftPad) + text + \" \".repeat(rightPad);\n    };\n"
  ]
];
let next=original.toString();
for(const [before,after]of edits){assert.equal(next.split(before).length,2);next=next.replace(before,after);}
assert.equal(sha(next),"525bf247e96eb398bc126bb53f86417d30fb59a0ecc2458f84d555079ee51ce1");
const check=spawnSync(process.execPath,['--input-type=module','--check'],{input:next,encoding:'utf8'});
assert.equal(check.status,0,'补丁语法检查失败，未修改');
const backup=file+'.welcome-width.bak',mode=fs.statSync(file).mode&0o777;
if(fs.existsSync(backup))assert.deepEqual(fs.readFileSync(backup),original);else fs.writeFileSync(backup,original,{flag:'wx',mode});
const temporary=file+'.welcome-width-'+process.pid+'.tmp';
try{fs.writeFileSync(temporary,next,{flag:'wx',mode});assert.deepEqual(fs.readFileSync(file),original,'原文件已变化，停止替换');fs.renameSync(temporary,file);}finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
console.log('欢迎框宽度补丁已应用；原文件备份：'+backup);
