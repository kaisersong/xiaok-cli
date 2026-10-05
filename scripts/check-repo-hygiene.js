import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { realpathSync, existsSync } from 'node:fs';

const NOISE_PREFIXES = [
  '.DS_Store',
  '.test-cache/',
  '.test-dist/',
  '.xiaok/state/',
  '.xiaok-test/',
];

function runGit(args, cwd) {
  return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
}

function runOptional(command, args) {
  try {
    return execFileSync(command, args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

export function parseStatusPorcelain(output) {
  return output
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line && !line.startsWith('##'))
    .map((line) => ({
      code: line.slice(0, 2),
      path: line.slice(3).split(' -> ').at(-1) ?? '',
    }));
}

function isNoisePath(path) {
  return NOISE_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix));
}

export function evaluateRepoHealth({
  repoRoot,
  branch,
  ahead,
  behind,
  entries,
  globalXiaokTarget,
  defaultBranch = 'master',
  reference = 'origin/master',
}) {
  const issues = [];
  const warnings = [];
  const noiseEntries = entries.map((entry) => entry.path).filter(isNoisePath);
  const trackedWorkEntries = entries
    .filter((entry) => entry.code !== '??' && !isNoisePath(entry.path))
    .map((entry) => entry.path);
  const untrackedWorkEntries = entries
    .filter((entry) => entry.code === '??' && !isNoisePath(entry.path))
    .map((entry) => entry.path);

  if (branch === defaultBranch) {
    if (behind > 0) issues.push(`${defaultBranch} is behind ${reference} by ${behind} commit(s)`);
    if (ahead > 0) issues.push(`${defaultBranch} is ahead of ${reference} by ${ahead} commit(s)`);
    if (trackedWorkEntries.length > 0) issues.push(`${defaultBranch} has tracked working tree changes`);
    if (untrackedWorkEntries.length > 0) {
      issues.push(`${defaultBranch} has untracked work items: ${untrackedWorkEntries.join(', ')}`);
    }
    if (globalXiaokTarget && globalXiaokTarget !== repoRoot) {
      warnings.push(`global xiaok points to ${globalXiaokTarget} instead of ${repoRoot}`);
    }
  } else {
    if (behind > 0) warnings.push(`${branch} is behind ${reference} by ${behind} commit(s)`);
    if (trackedWorkEntries.length > 0 || untrackedWorkEntries.length > 0) {
      warnings.push(`${branch} has active worktree changes`);
    }
  }

  if (noiseEntries.length > 0) {
    warnings.push(`runtime noise detected: ${noiseEntries.join(', ')}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    warnings,
  };
}

function getGlobalXiaokTarget() {
  const xiaokPath = runOptional(process.platform === 'win32' ? 'where' : 'which', ['xiaok']);
  if (!xiaokPath) return '';
  const firstPath = xiaokPath.split(/\r?\n/).find(Boolean);
  if (!firstPath) return '';
  try {
    const resolvedBin = realpathSync(firstPath);
    return dirname(dirname(resolvedBin));
  } catch {
    return '';
  }
}

function checkedGit(cwd, args) {
  const result = execFileSync('git', ['-C', cwd, ...args], {encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:15_000});
  return result.trimEnd();
}
function optionalGit(cwd,args) { try { return checkedGit(cwd,args); } catch { return ''; } }
export function collectWorkspaceHealth({cwd=process.cwd(),fetch=true,globalXiaokTarget=''}={}) {
  const root=checkedGit(cwd,['rev-parse','--show-toplevel']);
  // Linked worktrees still resolve their siblings beside the primary checkout.
  const common=resolve(root,checkedGit(root,['rev-parse','--git-common-dir']));
  const primary=common.endsWith('.git') ? dirname(common) : root;
  const workspace=dirname(primary);
  const repositories=['xiaok-cli','kswarm','intent-broker','kai-xiaok-plugins'].map((name,index)=>{
    const repoRoot=index===0?root:join(workspace,name);
    const base={name,repoRoot,fetchSucceeded:null,freshnessVerified:false,issues:[],warnings:[]};
    if(!existsSync(repoRoot)){base.issues.push('missing repository');return {...base,ok:false};}
    try {
      if(realpathSync(checkedGit(repoRoot,['rev-parse','--show-toplevel']))!==realpathSync(repoRoot))throw new Error('not a repository root');
      const upstream=optionalGit(repoRoot,['rev-parse','--abbrev-ref','--symbolic-full-name','@{upstream}']);
      const remote=optionalGit(repoRoot,['config','--get','branch.'+checkedGit(repoRoot,['branch','--show-current'])+'.remote'])||'origin';
      if(remote==='.' || !optionalGit(repoRoot,['remote']).split(/\r?\n/).includes(remote))throw new Error('missing remote');
      if(fetch){
        try { checkedGit(repoRoot,['fetch','--prune',remote]); checkedGit(repoRoot,['remote','set-head',remote,'--auto']);base.fetchSucceeded=true;base.freshnessVerified=true; }
        catch {base.fetchSucceeded=false;base.issues.push('git fetch/default-head discovery failed; freshness unverified');}
      } else base.warnings.push('fetch skipped; freshness unverified');
      const reference=optionalGit(repoRoot,['symbolic-ref','--short','refs/remotes/'+remote+'/HEAD']);
      if(!reference.startsWith(remote+'/'))throw new Error('default remote branch unavailable');
      const defaultBranch=reference.slice(remote.length+1);
      const branch=checkedGit(repoRoot,['branch','--show-current']);
      if(!branch)base.issues.push('detached HEAD');
      const counts=checkedGit(repoRoot,['rev-list','--left-right','--count','HEAD...'+reference]).split(/\s+/).map(Number);
      const [ahead,behind]=counts;
      let upstreamDivergence;
      if(upstream){const [upAhead,upBehind]=checkedGit(repoRoot,['rev-list','--left-right','--count','HEAD...'+upstream]).split(/\s+/).map(Number);upstreamDivergence={reference:upstream,ahead:upAhead,behind:upBehind};if(upBehind>0)base.issues.push('branch is behind its upstream by '+upBehind+' commit(s)');}
      else if(branch!==defaultBranch)base.warnings.push('feature branch has no upstream');
      const entries=parseStatusPorcelain(checkedGit(repoRoot,['status','--short']));
      const health=evaluateRepoHealth({repoRoot,branch,defaultBranch,reference,ahead,behind,entries,globalXiaokTarget:index===0?globalXiaokTarget:''});
      base.issues.push(...health.issues);base.warnings.push(...health.warnings);
      return {...base,branch,defaultBranch,reference,ahead,behind,upstream:upstreamDivergence,ok:base.issues.length===0};
    } catch(error) {base.issues.push(error instanceof Error && ['missing remote','default remote branch unavailable','not a repository root'].includes(error.message)?error.message:'repository inspection failed');return {...base,ok:false};}
  });
  return {ok:repositories.every(r=>r.ok),freshnessVerified:repositories.every(r=>r.freshnessVerified),repositories};
}
export function main(args=process.argv.slice(2)) {
  if(args.some(a=>!['--no-fetch','--json'].includes(a)))throw new Error('Usage: hygiene:check [--no-fetch] [--json]');
  const report=collectWorkspaceHealth({fetch:!args.includes('--no-fetch'),globalXiaokTarget:getGlobalXiaokTarget()});
  if(args.includes('--json'))process.stdout.write(JSON.stringify(report,null,2)+'\n');
  else for(const repo of report.repositories){
    process.stdout.write(`[repo-hygiene] ${repo.name}: ${repo.repoRoot} (${repo.branch??'unknown'}) fetch=${repo.fetchSucceeded??'skipped'}\n`);
    for(const issue of repo.issues)process.stdout.write('  ERROR: '+issue+'\n');
    for(const warning of repo.warnings)process.stdout.write('  WARN: '+warning+'\n');
  }
  process.exitCode=report.ok?0:1;
  return report;
}
