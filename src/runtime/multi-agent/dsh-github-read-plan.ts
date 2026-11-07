import {
  captureGithubReadData, githubReadFail, githubReadFields, githubReadFreeze, githubReadHash,
  githubReadId, githubReadRecord, githubReadText, githubReadTimestamp,
  githubReadAppend, githubReadIncludes, githubReadJoin, githubReadMap, githubReadOwn,
  githubReadSome, githubReadSort, githubReadTest, githubReadUnique,
  parseGithubBoundRepository, parseGithubParentIssue,
  type GithubBoundRepository, type GithubParentIssue, type GithubRequestKind,
} from './dsh-github-read-data.js';

const apply = Reflect.apply, safeInteger = Number.isSafeInteger, isArray = Array.isArray;
const NativeURL = URL, nativeExec = RegExp.prototype.exec, nativeString = String;
const slice = String.prototype.slice, indexOf = String.prototype.indexOf, stringIncludes = String.prototype.includes;
const ownDescriptor = Object.getOwnPropertyDescriptor;
const urlOrigin = ownDescriptor(URL.prototype, 'origin')!.get!, urlPath = ownDescriptor(URL.prototype, 'pathname')!.get!;
const urlUser = ownDescriptor(URL.prototype, 'username')!.get!, urlPassword = ownDescriptor(URL.prototype, 'password')!.get!;
const urlHash = ownDescriptor(URL.prototype, 'hash')!.get!, urlPort = ownDescriptor(URL.prototype, 'port')!.get!;
const urlParams = ownDescriptor(URL.prototype, 'searchParams')!.get!, paramsEach = URLSearchParams.prototype.forEach;

type Bound = { schemaVersion: 1; boundRepository: GithubBoundRepository };
export type GithubGetInput = { schemaVersion: 1; kind: 'user'; boundRepository: null }
  | (Bound & { kind: 'repository' })
  | (Bound & { kind: 'labels' | 'events'; page: number })
  | (Bound & { kind: 'issues'; page: number; since: string | null; labelNames: readonly string[] })
  | (Bound & { kind: 'issue'; parentIssue: GithubParentIssue })
  | (Bound & { kind: 'issue_comments'; parentIssue: GithubParentIssue; page: number; since: string | null })
  | (Bound & { kind: 'comment'; parentIssue: GithubParentIssue; commentId: string });
export interface GithubGetPlan {
  schemaVersion: 1; kind: GithubRequestKind; method: 'GET'; origin: 'https://api.github.com'; pathname: string;
  query: readonly (readonly [string, string])[]; boundRepository: GithubBoundRepository | null;
  parentIssue: GithubParentIssue | null; commentId: string | null; page: number | null;
  since: string | null; labelNames: readonly string[]; expectedBody: ''; planHash: string;
}
export type GithubNextPage = Readonly<{ kind: 'next'; plan: GithubGetPlan }
  | { kind: 'end'; pagination: 'page_end'; history: 'unknown' }
  | { kind: 'unknown'; reason: 'LINK_INVALID' | 'PAGE_LIMIT' }>;
const pageKinds = ['labels', 'events', 'issues', 'issue_comments'];
const expectedFields: Record<GithubRequestKind, readonly string[]> = {
  user: [], repository: [], labels: ['page'], events: ['page'], issues: ['page', 'since', 'labelNames'],
  issue: ['parentIssue'], issue_comments: ['parentIssue', 'page', 'since'], comment: ['parentIssue', 'commentId'],
};
const literalCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Finite GET data only. This does not authorize or perform a request. */
export function planGithubGet(input: unknown): Readonly<GithubGetPlan> {
  const r = githubReadRecord(captureGithubReadData(input));
  if (r.schemaVersion !== 1 || typeof r.kind !== 'string' || !githubReadOwn(expectedFields, r.kind)) githubReadFail();
  const kind = r.kind as GithubRequestKind;
  const fields = ['schemaVersion', 'kind', 'boundRepository'];
  for (let i = 0; i < expectedFields[kind].length; i++) githubReadAppend(fields, expectedFields[kind][i]!);
  githubReadFields(r, fields);
  const bound = kind === 'user' ? null : parseGithubBoundRepository(r.boundRepository);
  if (kind === 'user' && r.boundRepository !== null) githubReadFail();
  const parent = githubReadIncludes(['issue', 'issue_comments', 'comment'], kind) ? parseGithubParentIssue(r.parentIssue, bound!) : null;
  if (parent?.isPullRequest) githubReadFail();
  const base = bound ? `/repos/${bound.owner}/${bound.repo}` : '';
  let pathname = kind === 'user' ? '/user' : base, page: number | null = null, commentId: string | null = null, since: string | null = null;
  let labelNames: string[] = [];
  const query: [string, string][] = [];
  if (githubReadIncludes(pageKinds, kind)) {
    if (typeof r.page !== 'number' || !safeInteger(r.page) || r.page < 1 || r.page > (kind === 'events' ? 3 : 16)) githubReadFail();
    page = r.page; githubReadAppend(query, ['page', nativeString(page)]); githubReadAppend(query, ['per_page', '100']);
  }
  if (kind === 'issues' || kind === 'issue_comments') {
    since = r.since === null ? null : githubReadTimestamp(r.since);
    if (since !== null) githubReadAppend(query, ['since', since]);
  }
  if (kind === 'issues') {
    if (!isArray(r.labelNames)) githubReadFail();
    labelNames = githubReadSort(githubReadMap(r.labelNames, value => githubReadText(value, 256)), literalCompare);
    if (!githubReadUnique(labelNames) || githubReadSome(labelNames, value => apply(stringIncludes, value, [',']))) githubReadFail();
    githubReadAppend(query, ['state', 'all']); githubReadAppend(query, ['sort', 'updated']); githubReadAppend(query, ['direction', 'asc']);
    if (labelNames.length) githubReadAppend(query, ['labels', githubReadJoin(labelNames, ',')]);
  }
  if (kind === 'labels' || kind === 'events' || kind === 'issues') pathname += `/${kind}`;
  if (kind === 'issue') pathname += `/issues/${parent!.number}`;
  if (kind === 'issue_comments') pathname += `/issues/${parent!.number}/comments`;
  if (kind === 'comment') { if (typeof r.commentId !== 'string') githubReadFail(); commentId = githubReadId(r.commentId); pathname += `/issues/comments/${commentId}`; }
  githubReadSort(query, (a, b) => literalCompare(a[0], b[0]) || literalCompare(a[1], b[1]));
  const value = { schemaVersion: 1 as const, kind, method: 'GET' as const, origin: 'https://api.github.com' as const, pathname, query, boundRepository: bound, parentIssue: parent, commentId, page, since, labelNames, expectedBody: '' as const };
  return githubReadFreeze({ ...value, planHash: githubReadHash('dsh-github-get-plan-v1', value) });
}
const planFields = ['schemaVersion', 'kind', 'method', 'origin', 'pathname', 'query', 'boundRepository', 'parentIssue', 'commentId', 'page', 'since', 'labelNames', 'expectedBody', 'planHash'];
function planInput(plan: GithubGetPlan): GithubGetInput {
  const base = { schemaVersion: 1 as const, kind: plan.kind, boundRepository: plan.boundRepository };
  const input: Record<string, unknown> = { ...base };
  const fields = expectedFields[plan.kind];
  for (let i = 0; i < fields.length; i++) { const key = fields[i]!; input[key] = plan[key as keyof GithubGetPlan]; }
  return input as GithubGetInput;
}
function parsePrevious(input: unknown): GithubGetPlan {
  const r = githubReadRecord(captureGithubReadData(input)); githubReadFields(r, planFields);
  if (typeof r.kind !== 'string' || !githubReadOwn(expectedFields, r.kind)) githubReadFail();
  const rebuilt = planGithubGet(planInput(r as unknown as GithubGetPlan));
  if (githubReadHash('dsh-github-get-plan-check-v1', r) !== githubReadHash('dsh-github-get-plan-check-v1', rebuilt)) githubReadFail();
  return rebuilt;
}
/** Link end is a page observation; it never certifies an event history. */
export function planGithubNextPage(previousInput: unknown, link: string | null, boundInput: unknown): GithubNextPage {
  const previous = parsePrevious(previousInput), bound = parseGithubBoundRepository(captureGithubReadData(boundInput));
  if (!previous.boundRepository || githubReadHash('dsh-github-bound-v1', bound) !== githubReadHash('dsh-github-bound-v1', previous.boundRepository) || !githubReadIncludes(pageKinds, previous.kind)) githubReadFail();
  const end = (): GithubNextPage => githubReadFreeze({ kind: 'end', pagination: 'page_end', history: 'unknown' });
  const invalid = (): GithubNextPage => githubReadFreeze({ kind: 'unknown', reason: 'LINK_INVALID' });
  if (link === null) return end();
  if (typeof link !== 'string' || !link.length || link.length > 16 * 1024 || githubReadTest(/[\r\n\u0000]/, link)) return invalid();
  // Consume the entire grammar with the original native exec, never a late public method.
  const grammar = /\s*<([^<>]*)>\s*;\s*rel="([a-z ]+)"\s*(,|$)/g;
  const next: string[] = [];
  let offset = 0;
  while (offset < link.length) {
    const match = apply(nativeExec, grammar, [link]) as RegExpExecArray | null;
    if (!match || match.index !== offset || grammar.lastIndex <= offset) return invalid();
    offset = grammar.lastIndex;
    if (githubReadTest(/(^| )next( |$)/, match[2]!)) githubReadAppend(next, match[1]!);
    if (match[3] === ',' && offset === link.length) return invalid();
  }
  if (!next.length) return end(); if (next.length !== 1) return invalid();
  const following = previous.page! + 1;
  if (following > (previous.kind === 'events' ? 3 : 16)) return githubReadFreeze({ kind: 'unknown', reason: 'PAGE_LIMIT' });
  const planned = planGithubGet({ ...planInput(previous), page: following });
  try {
    const candidate = next[0]!, url = new NativeURL(candidate), pathname = apply(urlPath, url, []) as string;
    const suffix = apply(slice, previous.pathname, [`/repos/${bound.owner}/${bound.repo}`.length]) as string;
    const alias = `/repositories/${bound.repositoryId}${suffix}`;
    const question = apply(indexOf, candidate, ['?']) as number;
    const rawPrefix = apply(slice, candidate, [0, question < 0 ? candidate.length : question]) as string;
    if (apply(urlOrigin, url, []) !== previous.origin || apply(urlUser, url, []) || apply(urlPassword, url, []) || apply(urlHash, url, []) || apply(urlPort, url, []) || apply(stringIncludes, candidate, ['\\'])
      || pathname !== previous.pathname && pathname !== alias || githubReadTest(/%(?:2f|5c|2e)/i, rawPrefix)) return invalid();
    // Reject URL parser normalization, including dot segments and explicit ports.
    if (rawPrefix !== `${previous.origin}${pathname}`) return invalid();
    const pairs: [string, string][] = [];
    apply(paramsEach, apply(urlParams, url, []), [(value: string, key: string) => githubReadAppend(pairs, [key, value])]);
    if (!githubReadUnique(githubReadMap(pairs, pair => pair[0]))) return invalid();
    githubReadSort(pairs, (a, b) => literalCompare(a[0], b[0]) || literalCompare(a[1], b[1]));
    if (githubReadHash('dsh-github-query-v1', pairs) !== githubReadHash('dsh-github-query-v1', planned.query)) return invalid();
    return githubReadFreeze({ kind: 'next', plan: planned });
  } catch { return invalid(); }
}
