// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { planGithubGet, planGithubNextPage } from '../../electron/dsh-github-read-plan.js';

const bound = { repositoryId: '123', nodeId: 'R_123', owner: 'octo', repo: 'demo' };
const parent = { repositoryId: '123', issueId: '900', nodeId: 'I_900', number: 7, isPullRequest: false };
const first = () => planGithubGet({ schemaVersion: 1, kind: 'issues', boundRepository: bound, page: 1, since: null, labelNames: [] });

describe('G01/G02 GitHub GET planning is data, not transport or authority', () => {
  it.each([
    { kind: 'user', boundRepository: null },
    { kind: 'repository', boundRepository: bound },
    { kind: 'labels', boundRepository: bound, page: 1 },
    { kind: 'events', boundRepository: bound, page: 1 },
    { kind: 'issues', boundRepository: bound, page: 1, since: null, labelNames: ['z', 'a b'] },
    { kind: 'issue', boundRepository: bound, parentIssue: parent },
    { kind: 'issue_comments', boundRepository: bound, parentIssue: parent, page: 1, since: '2026-11-01T00:00:00Z' },
    { kind: 'comment', boundRepository: bound, parentIssue: parent, commentId: '44' },
  ])('plans fixed $kind GET without IO', input => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    try {
      const plan = planGithubGet({ schemaVersion: 1, ...input });
      expect(plan.method).toBe('GET'); expect(plan.origin).toBe('https://api.github.com');
      expect(plan.expectedBody).toBe(''); expect(plan.planHash).toMatch(/^[a-f0-9]{64}$/);
      expect(fetch).not.toHaveBeenCalled(); expect(Object.isFrozen(plan.query)).toBe(true);
    } finally { vi.unstubAllGlobals(); }
  });
  it('normalizes labels and query order with stable domain-separated hashes', () => {
    const a = planGithubGet({ schemaVersion: 1, kind: 'issues', boundRepository: bound, page: 1, since: null, labelNames: ['z', 'a'] });
    const b = planGithubGet({ labelNames: ['a', 'z'], since: null, page: 1, boundRepository: { ...bound }, kind: 'issues', schemaVersion: 1 });
    expect(a).toEqual(b); expect(a.query).toEqual([['direction', 'asc'], ['labels', 'a,z'], ['page', '1'], ['per_page', '100'], ['sort', 'updated'], ['state', 'all']]);
    expect(first().planHash).not.toBe(planGithubGet({ schemaVersion: 1, kind: 'events', boundRepository: bound, page: 1 }).planHash);
  });
  it.each([
    { ...bound, repo: '../else' }, { ...bound, repo: '%2Felse' }, { ...bound, owner: 'user@evil' },
    { ...bound, repositoryId: '00123' }, { ...bound, repo: '..' }, { ...bound, repo: 'x\\y' },
  ])('rejects unapproved route input %j', bad => {
    expect(() => planGithubGet({ schemaVersion: 1, kind: 'repository', boundRepository: bad })).toThrow('dsh_github_read_contract');
  });
  it('rejects local extra fields, wrong parent, duplicate labels and malformed dates', () => {
    expect(() => planGithubGet({ schemaVersion: 1, kind: 'repository', boundRepository: bound, method: 'DELETE' })).toThrow();
    expect(() => planGithubGet({ schemaVersion: 1, kind: 'comment', boundRepository: bound, parentIssue: { ...parent, repositoryId: '124' }, commentId: '44' })).toThrow();
    expect(() => planGithubGet({ schemaVersion: 1, kind: 'issue', boundRepository: bound, parentIssue: { ...parent, isPullRequest: true } })).toThrow();
    expect(() => planGithubGet({ schemaVersion: 1, kind: 'issues', boundRepository: bound, page: 1, since: '2026-02-30T00:00:00Z', labelNames: [] })).toThrow();
    expect(() => planGithubGet({ schemaVersion: 1, kind: 'issues', boundRepository: bound, page: 1, since: null, labelNames: ['a', 'a'] })).toThrow();
  });
  it('rejects getter and proxy local input without calling either', () => {
    let calls = 0;
    const getter = { schemaVersion: 1, kind: 'repository', get boundRepository() { calls++; return bound; } };
    const proxy = new Proxy({}, { ownKeys() { calls++; return []; }, get() { calls++; return undefined; } });
    expect(() => planGithubGet(getter)).toThrow(); expect(() => planGithubGet(proxy)).toThrow(); expect(calls).toBe(0);
  });
  it('regenerates a valid next page, including stable numeric repository aliases', () => {
    for (const path of ['/repos/octo/demo/issues', '/repositories/123/issues']) {
      const result = planGithubNextPage(first(), `<https://api.github.com${path}?state=all&sort=updated&direction=asc&per_page=100&page=2>; rel="next"`, bound);
      expect(result.kind).toBe('next');
      if (result.kind === 'next') { expect(result.plan.page).toBe(2); expect(result.plan.pathname).toBe('/repos/octo/demo/issues'); }
    }
  });
  it('a missing Link is only a page end; it supplies no history completeness', () => {
    expect(planGithubNextPage(first(), null, bound)).toEqual({ kind: 'end', pagination: 'page_end', history: 'unknown' });
    expect(planGithubNextPage(first(), '<https://api.github.com/x>; rel="last"', bound)).toEqual({ kind: 'end', pagination: 'page_end', history: 'unknown' });
  });
  it.each([
    'https://evil.test/repos/octo/demo/issues?page=2',
    'https://api.github.com/repos/octo/other/issues?page=2',
    'https://api.github.com/repositories/124/issues?page=2',
    'https://api.github.com/repos/octo/demo/issues?page=1',
    'https://api.github.com/repos/octo/demo/issues?page=2&page=2',
    'https://api.github.com/repos/octo/demo/issues?page=2&per_page=100&state=closed&sort=updated&direction=asc',
    'https://api.github.com/repos/octo/demo/issues?page=2&per_page=100&state=all&sort=updated&direction=asc&token=oops',
    'https://api.github.com/repos/octo/demo/issues?page=2&per_page=100&state=all&sort=updated&direction=asc#x',
  ])('marks invalid provider Link unknown: %s', url => {
    expect(planGithubNextPage(first(), `<${url}>; rel="next"`, bound)).toEqual({ kind: 'unknown', reason: 'LINK_INVALID' });
  });
  it('refuses duplicate next, altered plans and bounded page overflow', () => {
    const link = '<https://api.github.com/repos/octo/demo/issues?direction=asc&page=2&per_page=100&sort=updated&state=all>; rel="next"';
    expect(planGithubNextPage(first(), `${link}, ${link}`, bound).kind).toBe('unknown');
    expect(() => planGithubNextPage({ ...first(), pathname: '/user' }, link, bound)).toThrow();
    const last = planGithubGet({ schemaVersion: 1, kind: 'events', boundRepository: bound, page: 3 });
    expect(planGithubNextPage(last, '<https://api.github.com/repos/octo/demo/events?page=4&per_page=100>; rel="next"', bound)).toEqual({ kind: 'unknown', reason: 'PAGE_LIMIT' });
  });
  it.each(['get', 'set'] as const)('does not consult inherited descriptor-shell %s accessors', key => {
    let calls = 0, error: unknown;
    Object.defineProperty(Object.prototype, key, { configurable: true, get() { calls++; return undefined; } });
    try { first(); } catch (caught) { error = caught; }
    finally { Reflect.deleteProperty(Object.prototype, key); }
    expect(calls).toBe(0); expect(error).toBeUndefined();
  });
  it('late RegExp.test cannot bless a traversal repository', () => {
    const original = RegExp.prototype.test; let emitted = false;
    RegExp.prototype.test = function (value: string) { return value === '../escape' ? true : Reflect.apply(original, this, [value]); };
    try { planGithubGet({ schemaVersion: 1, kind: 'repository', boundRepository: { ...bound, repo: '../escape' } }); emitted = true; } catch { /* Expected contract rejection. */ }
    finally { RegExp.prototype.test = original; }
    expect(emitted).toBe(false);
  });
  it('an unconditional late RegExp.test=true still cannot emit a traversal plan', () => {
    const original = RegExp.prototype.test; let emitted = false;
    RegExp.prototype.test = () => true;
    try { planGithubGet({ schemaVersion: 1, kind: 'repository', boundRepository: { ...bound, repo: '../escape' } }); emitted = true; } catch { /* Expected contract rejection. */ }
    finally { RegExp.prototype.test = original; }
    expect(emitted).toBe(false);
  });
  it('late Array.map cannot silently erase the selected label filter', () => {
    const original = Array.prototype.map; let plan: ReturnType<typeof planGithubGet> | undefined;
    Array.prototype.map = function () { return []; };
    try { plan = planGithubGet({ schemaVersion: 1, kind: 'issues', boundRepository: bound, page: 1, since: null, labelNames: ['required'] }); }
    finally { Array.prototype.map = original; }
    expect(plan?.query).toContainEqual(['labels', 'required']);
  });
  it('uses original sort, membership, regex exec and descriptor-definition siblings', () => {
    const sort = Array.prototype.sort, includes = Array.prototype.includes, exec = RegExp.prototype.exec, define = Object.defineProperty;
    let definitionCalls = 0, plan: ReturnType<typeof planGithubGet> | undefined, rejected = false;
    Array.prototype.sort = function () { return this; };
    Array.prototype.includes = () => true;
    RegExp.prototype.exec = () => ['forged'] as unknown as RegExpExecArray;
    Object.defineProperty = ((target: object) => { definitionCalls++; return target; }) as typeof define;
    try {
      plan = planGithubGet({ schemaVersion: 1, kind: 'issues', boundRepository: bound, page: 1, since: null, labelNames: ['z', 'a'] });
      try { planGithubGet({ schemaVersion: 1, kind: 'repository', boundRepository: { ...bound, repo: '../escape' } }); } catch { rejected = true; }
    } finally { Array.prototype.sort = sort; Array.prototype.includes = includes; RegExp.prototype.exec = exec; Object.defineProperty = define; }
    expect(plan?.labelNames).toEqual(['a', 'z']); expect(rejected).toBe(true); expect(definitionCalls).toBe(0);
  });
});
