import {posix,win32} from 'node:path';

/** Conservative lexical admission. Ambiguous text stays a proposal; these
 * helpers never accept a model's policy or grant a path from a URL/reference. */
export function negatesProjectCreation(prompt:string):boolean {
  return /(?:不要|不用|不需要|先不|暂不|先别|别|勿|无需|不)[^\n，。；,.!?？!]{0,8}(?:创建|新建|建立|建)[^\n，。；,.!?？!]{0,12}(?:项目|project)/iu.test(prompt)
    || /\b(?:do\s+not|don't|never|no\s+need\s+to)\s+(?:create|set\s+up|make)\b[^\n,.?!;]{0,40}\bproject\b/iu.test(prompt);
}

export function hasPlanOnlyProjectIntent(prompt:string):boolean {
  return /(?:只|仅)(?:(?:要|做|出|需|想|生成|制定|提供|给)\s*)?(?:个|一个|一份)?\s*(?:计划|规划|方案)/u.test(prompt)
    || /(?:先|暂时|目前)(?:只|仅)?\s*(?:做|出|生成|制定)?\s*(?:计划|规划)/u.test(prompt)
    || /(?:不要|不用|不需要|先不|暂不|先别|别|勿|无需)[^\n，。；,.!?？!]{0,8}(?:执行|启动|派发|运行)/u.test(prompt)
    || /(?:等我确认|让我审批|待我确认|需要我确认|经过我确认|等我批准|执行前.{0,8}(?:确认|审批))/u.test(prompt)
    || /\b(?:plan(?:ning)?\s+only|only\s+(?:(?:make|create|do|produce|generate)\s+)?(?:a\s+)?plan|(?:do\s+not|don't|never)\s+(?:auto(?:matically)?\s+)?(?:execute|start|dispatch|run)|(?:wait|ask)\s+for\s+(?:my\s+)?(?:approval|confirmation))\b/iu.test(prompt);
}

export function isUserRequestedProjectFolder(prompt:string,candidate:string,platform:NodeJS.Platform=process.platform):boolean {
  const paths=platform==='win32'?win32:posix;
  const normalize=(value:string):string|undefined=>{
    if(!value || value.includes('\0') || !paths.isAbsolute(value))return undefined;
    if(platform==='win32'&&!/^(?:[A-Za-z]:[\\/]|[\\/]{2}[^\\/]+[\\/][^\\/]+)/u.test(value))return undefined;
    const normalized=paths.normalize(value),root=paths.parse(normalized).root;
    if(normalized===root)return undefined; // Root grants require a trusted picker.
    const withoutTrailing=normalized.replace(/[\\/]+$/u,'');
    return platform==='win32'?withoutTrailing.toLowerCase():withoutTrailing;
  };
  const requested=normalize(candidate);if(!requested)return false;
  // Keep offsets while removing URL bodies, including query-string paths.
  const source=prompt.replace(/\b(?:[a-z][a-z0-9+.-]*:\/\/|www\.)[^\s<>"'`“”‘’]+/giu,value=>' '.repeat(value.length));
  const tokens=/"([^"\n]+)"|'([^'\n]+)'|`([^`\n]+)`|“([^”\n]+)”|‘([^’\n]+)’|(?<![A-Za-z0-9._:/\\])(?:[A-Za-z]:[\\/]|\\\\|\/)[^\s"'`“”‘’，。；：、!?？\[\]()（）<>]+/gu;
  for(const match of source.matchAll(tokens)){
    const quoted=match.slice(1).find(value=>value!==undefined);
    const token=quoted ?? match[0].replace(/[.!?]+$/u,'');
    if(normalize(token)!==requested)continue;
    const prefix=source.slice(Math.max(0,match.index-100),match.index);
    const suffix=source.slice(match.index+match[0].length,match.index+match[0].length+40);
    const folderDirective=/(?:工作(?:目录|文件夹)|项目(?:目录|文件夹)|输出(?:目录|文件夹)|work(?:ing)?[\s_-]*(?:dir(?:ectory)?|folder)|workspace|保存到|存到|放到|放在|创建在|新建在|建在|目录(?:为|是)?)[\s=:：]*$/iu.test(prefix);
    const reference=/(?:参考|资料|来源|引用|读取|read|source|reference)[^\n，。；,.]{0,24}$/iu.test(prefix);
    const inLocation=/(?:在|于|\b(?:in|under))\s*$/iu.test(prefix)
      && /(?:创建|新建|建立|建)[^\n，。；,.]{0,20}项目|\b(?:create|make|set\s+up)\b[^\n,.]{0,30}\bproject\b/iu.test(prefix+suffix);
    const clause=prefix.split(/[\n，。；,.;!?？!]/u).at(-1) ?? '';
    const negated=/(?:不要|不用|不需要|先不|暂不|先别|别|勿|无需|不)|\b(?:do\s+not|don't|never|not)\b/iu.test(clause);
    if(!negated&&!reference&&(folderDirective||inLocation))return true;
  }
  return false;
}
