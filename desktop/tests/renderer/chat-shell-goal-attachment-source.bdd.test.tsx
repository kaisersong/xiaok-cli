import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, type ComponentProps, type ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import type { DesktopGoalChangedEvent, DesktopGoalMutationResult, DesktopGoalProjection, DesktopGoalTaskPrepared, GoalAttachmentRequest } from '../../electron/preload-api';
import type { DesktopTaskEvent, TaskSnapshot } from '../../../src/runtime/task-host/types';
import type { ThreadRecord } from '../../renderer/src/api/types';
import type { ChatView as ActualChatView } from '../../renderer/src/components/ChatView';

const f = vi.hoisted(() => ({ getThread: vi.fn(), recoverTask: vi.fn(), subscribeTask: vi.fn(), updateThreadTaskId: vi.fn(),
  createTask: vi.fn(), readFileContent: vi.fn(), answerQuestion: vi.fn(), cancelTask: vi.fn(), setCollapsed: vi.fn() }));
vi.mock('../../renderer/src/api', () => ({ api: { ...f, updateThreadTitle: vi.fn(async () => {}), listSkills: vi.fn(async () => []) } }));
vi.mock('../../renderer/src/layouts/AppLayout', () => ({ useSidebarCollapse: () => ({ collapsed: false, setCollapsed: f.setCollapsed }), AppLayout: () => null }));
// Leaf presentation only: real ChatShell owns every state transition, real
// GoalBar drives semantic handlers, and the production attachment helper runs.
vi.mock('../../renderer/src/components/ChatView', () => ({ ChatView: (p: ComponentProps<typeof ActualChatView>) => <>
  <form onSubmit={event => { event.preventDefault(); void p.onSubmit(p.prompt); }}>
    <input aria-label="chat draft" value={p.prompt} onChange={event => p.onPromptChange(event.target.value)} />
    <button type="submit">ordinary submit</button>
  </form>
  <output data-testid="display-source">{p.thread.currentTaskId}</output>
  <output data-testid="display-status">{p.status}</output>
  <output data-testid="stream">{p.streamingText}</output>
  <output data-testid="question">{p.currentQuestion?.prompt}</output>
  <output data-testid="current-result">{JSON.stringify(p.result)}</output>
  <output data-testid="history">{JSON.stringify(p.messages)}</output>
  <output data-testid="files">{JSON.stringify(p.generatedFiles)}</output>
  <output data-testid="canvas-visible">{String(p.canvasOpen)}</output>
  <button type="button" onClick={p.onToggleCanvas}>toggle canvas</button>
  <button type="button" onClick={() => p.onQueue?.(p.prompt, [])}>queue current draft</button>
  {p.currentQuestion?.choices?.map(choice => <button type="button" key={choice.id} onClick={() => p.onAnswer(choice.id)}>{choice.label}</button>)}
  {p.status === 'running' && <button type="button" onClick={p.onCancel}>stop current task</button>}
</> }));
vi.mock('../../renderer/src/components/TaskPanel', () => ({ TaskPanel: (p: { goalContent?: ReactNode; planSteps: unknown }) =>
  <><output data-testid="plan">{JSON.stringify(p.planSteps)}</output>{p.goalContent}</> }));
vi.mock('../../renderer/src/components/CanvasPanel', () => ({ CanvasPanel: (p: { initialPreviewContent?: string; events?: unknown }) =>
  <><output data-testid="canvas-preview">{p.initialPreviewContent}</output><output data-testid="canvas-events">{JSON.stringify(p.events)}</output></> }));

import { ChatShell } from '../../renderer/src/components/ChatShell';
import { LocaleProvider, useLocale } from '../../renderer/src/contexts/LocaleContext';
import { _resetDesktopApiCache } from '../../renderer/src/shared/desktop';

function deferred<T = void>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  // Some baseline failures never reach this optional dependency. Preserve the
  // original Promise rejection for production, but don't manufacture an
  // unhandled rejection when asserting that the required call is missing.
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
const threadId = 'thread-source';
function thread(id = threadId): ThreadRecord {
  return { id, title: 'saved conversation', status: 'idle', mode: 'work', createdAt: 1, updatedAt: 1,
    starred: false, gtdBucket: 'inbox', pinnedAt: null, currentTaskId: 'A', taskIds: ['A'] };
}
function goal(id = 'goal-B', revision = 1): DesktopGoalProjection {
  return { activation: 'disarmed', state: { goalId: id, sessionId: threadId, revision, epoch: 1,
    objective: `objective ${id}`, expectedEvidenceKinds: ['answer'], status: 'active', turnsUsed: 0, tokensUsed: 0,
    activeWallClockMs: 0, budgetLimits: { turnLimit: 2 }, consecutiveBlockedTurns: 0, createdAt: 1, updatedAt: 1 } };
}
function prepared(taskId = 'B', attachmentId = `attach-${taskId}`, origin: 'user' | 'continuation' = 'continuation'): DesktopGoalTaskPrepared {
  return { attachmentId, threadId, taskId, expiresAt: Date.now() + 60_000, goalRef: { goalId: `goal-${taskId}`, revision: 1 },
    attachmentSource: { kind: 'request', requestId: null },
    executionScope: { kind: 'goal_turn', origin, threadId, goalId: `goal-${taskId}`, epoch: 1, goalTurnId: `turn-${taskId}` } };
}
function snapshot(taskId: string, status: TaskSnapshot['status'] = 'running', events: DesktopTaskEvent[] = []): TaskSnapshot {
  return { taskId, sessionId: threadId, status, prompt: `prompt ${taskId}`, materials: [], events, createdAt: 1, updatedAt: 1,
    multiAgentPreparation: { groupId: 'group-source', rootEpoch: 1, rootTurnId: `root-turn-${taskId}`, preparationId: `preparation-${taskId}`, bootId: 'boot-source' },
    ...(taskId === 'A' ? status === 'running' ? { hostDelivery: { version: 1, revision: 1, status: 'checking', stage: 'verify',
      verification: 'pending', hostSettlement: 'pending', readerCleanup: 'pending', storeCleanup: 'none', startedAt: 1, deadlineAt: 30_001 } as const } : {}
      : { executionScope: prepared(taskId).executionScope }) };
}
function question(taskId: string, prompt = `${taskId} question`): Extract<DesktopTaskEvent, { type: 'needs_user' }> {
  return { type: 'needs_user', question: { taskId, questionId: `question-${taskId}`, kind: 'freeform', prompt } };
}
function result(summary: string): Extract<DesktopTaskEvent, { type: 'result' }> {
  return { type: 'result', result: { summary, artifacts: [] } };
}
function artifact(artifactId: string) {
  return { artifactId, title: artifactId, kind: 'text' as const, createdAt: '2026-09-07T00:00:00.000Z', previewAvailable: false };
}
interface Observer { taskId: string; handler: (event: DesktopTaskEvent) => void; release: ReturnType<typeof vi.fn>; active: boolean }
let observers: Observer[], preparedListeners: Set<(value: DesktopGoalTaskPrepared) => void>, goalListeners: Set<(value: DesktopGoalChangedEvent) => void>;
let currentGoal: DesktopGoalProjection | null, order: string[];
let ack: ReturnType<typeof vi.fn>, create: ReturnType<typeof vi.fn>, replace: ReturnType<typeof vi.fn>, resume: ReturnType<typeof vi.fn>, cancel: ReturnType<typeof vi.fn>;
let nextDomReply: DesktopGoalTaskPrepared | null;
let requests: Array<{ method: 'create' | 'replace' | 'resume'; input: GoalAttachmentRequest }>;
let replies: Map<string, DesktopGoalTaskPrepared>;
function replyFor(input: GoalAttachmentRequest, value = prepared()): DesktopGoalMutationResult {
  return { goal: goal(value.goalRef.goalId), preparedTask: { ...value,
    attachmentSource: { kind: 'request', requestId: input.requestId ?? null } } };
}
function semantic(method: 'create' | 'replace' | 'resume', input: GoalAttachmentRequest): Promise<DesktopGoalMutationResult> {
  requests.push({ method, input: { ...input } });
  // A per-call dependency reply, not a handoff implementation. Every request
  // still originates at the real GoalBar and traverses the real ChatShell.
  const response = nextDomReply ? Promise.resolve(replyFor(input, nextDomReply)) : ({ create, replace, resume }[method])(input);
  nextDomReply = null;
  return response.then((value: DesktopGoalMutationResult) => {
    replies.set(value.preparedTask.attachmentId, value.preparedTask); return value;
  });
}
function observer(id: string) { const found = observers.findLast(value => value.taskId === id); if (!found) throw new Error(`missing fixture observer ${id}`); return found; }
function activeIds() { return observers.filter(value => value.active).map(value => value.taskId); }
async function emit(source: Observer, event: DesktopTaskEvent) { await act(async () => source.handler(event)); }
async function announceRaw(value: DesktopGoalTaskPrepared) { await act(async () => { for (const listener of preparedListeners) listener(value); }); }
async function repeatPrepared(attachmentId = 'attach-B') {
  const value = replies.get(attachmentId); if (!value) throw new Error(`fixture missing prepared reply ${attachmentId}`);
  await announceRaw(structuredClone(value));
}
async function announce(value = prepared()) {
  // R4: an uncorrelated request event no longer starts attachment. Old U1–U10
  // cases now prepare through a real explicit resume of the supplied main Goal
  // fact; this is not a fabricated automatic child of ordinary post-seal A.
  await changed(goal(value.goalRef.goalId));
  nextDomReply = { ...value, executionScope: { ...value.executionScope, origin: 'continuation' } };
  const before = requests.length;
  fireEvent.click(screen.getByRole('button', { name: '恢复' }));
  await act(async () => {});
  expect(requests).toHaveLength(before + 1); expect(nextDomReply).toBeNull();
}
async function changed(value: DesktopGoalProjection) { currentGoal = value; await act(async () => { for (const listener of goalListeners) listener({ threadId, goal: value }); }); }
function Navigate() {
  const navigate = useNavigate(); const { setLocale } = useLocale(); return <>
    <button type="button" onClick={() => setLocale('en')}>English locale</button>
    <button type="button" onClick={() => navigate('/t/other-thread', { state: { createGoal: true, draftPrompt: 'other draft' } })}>other thread</button>
    <button type="button" onClick={() => navigate(`/t/${threadId}`, { state: { createGoal: true } })}>original thread</button>
  </>;
}
async function mount(strict = false, waitForA = true) {
  const content = <MemoryRouter initialEntries={[{ pathname: `/t/${threadId}`, state: { createGoal: currentGoal === null, draftPrompt: 'saved draft' } }]}>
    <LocaleProvider><Navigate /><Routes><Route path="/t/:taskId" element={<ChatShell />} /></Routes></LocaleProvider>
  </MemoryRouter>;
  let view!: ReturnType<typeof render>;
  await act(async () => { view = render(strict ? <StrictMode>{content}</StrictMode> : content); });
  if (waitForA) await waitFor(() => expect(activeIds()).toContain('A'));
  return view;
}
function createViaDom() {
  fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'new objective draft' } });
  fireEvent.change(screen.getByLabelText('完成条件'), { target: { value: 'new criterion draft' } });
  fireEvent.click(screen.getByRole('button', { name: '确认创建' }));
}
function visibleState() { return ['display-source', 'display-status', 'stream', 'question', 'current-result', 'history', 'plan', 'files', 'canvas-visible', 'canvas-events']
  .map(id => screen.queryByTestId(id)?.textContent ?? null); }

beforeEach(() => {
  localStorage.clear(); localStorage.setItem('xiaok:locale', 'zh');
  observers = []; preparedListeners = new Set(); goalListeners = new Set(); currentGoal = null; order = [];
  nextDomReply = null; requests = []; replies = new Map();
  for (const mock of Object.values(f)) mock.mockReset();
  f.getThread.mockImplementation(async (id: string) => id === threadId ? thread(id) : { ...thread(id), currentTaskId: null, taskIds: [] });
  f.recoverTask.mockImplementation(async (id: string) => ({ snapshot: snapshot(id) }));
  f.updateThreadTaskId.mockImplementation(async (_thread: string, id: string) => { order.push(`update:${id}`); });
  f.readFileContent.mockResolvedValue({ content: 'file content' });
  f.createTask.mockResolvedValue({ taskId: 'ordinary-B' });
  f.subscribeTask.mockImplementation((taskId: string, handler: (event: DesktopTaskEvent) => void) => {
    order.push(`subscribe:${taskId}`);
    const item: Observer = { taskId, handler, active: true, release: vi.fn() };
    item.release.mockImplementation(() => { item.active = false; order.push(`release:${taskId}`); });
    observers.push(item); return item.release;
  });
  ack = vi.fn(async ({ attachmentId }: { attachmentId: string }) => { order.push(`ack:${attachmentId}`); });
  create = vi.fn(async (input: GoalAttachmentRequest): Promise<DesktopGoalMutationResult> => replyFor(input, prepared('B', 'attach-B', 'user')));
  replace = vi.fn(async (input: GoalAttachmentRequest): Promise<DesktopGoalMutationResult> => replyFor(input, prepared('B', 'attach-B', 'user')));
  resume = vi.fn(async (input: GoalAttachmentRequest): Promise<DesktopGoalMutationResult> => replyFor(input));
  cancel = vi.fn(async () => {});
  window.xiaokDesktop = { getGoal: vi.fn(async () => currentGoal),
    createGoal: (input: GoalAttachmentRequest) => semantic('create', input),
    replaceGoal: (input: GoalAttachmentRequest) => semantic('replace', input),
    resumeGoal: (input: GoalAttachmentRequest) => semantic('resume', input),
    cancelTask: cancel, ackGoalTaskAttached: ack,
    setGoalUserQueuePending: vi.fn(async () => {}),
    onGoalChanged: (listener: (value: DesktopGoalChangedEvent) => void) => { goalListeners.add(listener); return () => goalListeners.delete(listener); },
    onGoalTaskPrepared: (listener: (value: DesktopGoalTaskPrepared) => void) => { preparedListeners.add(listener); return () => preparedListeners.delete(listener); },
  } as unknown as typeof window.xiaokDesktop;
  _resetDesktopApiCache();
  vi.stubGlobal('ResizeObserver', class { constructor(private callback: ResizeObserverCallback) {} observe() { this.callback([{ contentRect: { width: 1200 } } as ResizeObserverEntry], this as unknown as ResizeObserver); } disconnect() {} });
});

describe('R4 U12–U14: actual semantic correlation, automatic predecessor and initialization ownership', () => {
  function clickSemantic(method: 'create' | 'replace' | 'resume') {
    if (method === 'create') createViaDom();
    else if (method === 'replace') { fireEvent.click(screen.getByRole('button', { name: '新建目标' })); createViaDom(); }
    else fireEvent.click(screen.getByRole('button', { name: '恢复' }));
  }
  function requestPayload(method: 'create' | 'replace' | 'resume', index = 0, task = 'B') {
    return replyFor(requests[index].input, prepared(task, `attach-${task}`, method === 'resume' ? 'continuation' : 'user'));
  }
  function automatic(predecessorTaskId = 'A'): DesktopGoalTaskPrepared {
    return { ...prepared(), goalRef: { goalId: 'goal-B', revision: 2 },
      attachmentSource: { kind: 'automatic', predecessorTaskId } };
  }
  function goalSnapshot(id = 'A', status: TaskSnapshot['status'] = 'running') {
    return { ...snapshot(id, status), executionScope: { ...prepared().executionScope, goalTurnId: `turn-${id}` } };
  }
  async function mountGoal(status: TaskSnapshot['status'] = 'running') {
    currentGoal = goal('goal-B', 1);
    f.recoverTask.mockImplementation(async (id: string) => ({ snapshot: goalSnapshot(id, status) }));
    const view = await mount(false, status === 'running');
    await waitFor(() => expect(screen.getByTestId('display-source')).toHaveTextContent('A'));
    return view;
  }

  it.each(['create', 'replace', 'resume'] as const)('U12 %s emits a real UUID and ignores its matching event until its captured reply creates the work', async method => {
    if (method !== 'create') currentGoal = goal();
    const reply = deferred<DesktopGoalMutationResult>(), pending = deferred();
    ({ create, replace, resume }[method]).mockReturnValue(reply.promise); ack.mockReturnValue(pending.promise);
    await mount(); const a = observer('A'); clickSemantic(method);
    expect.soft(requests[0].input.requestId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    const value = requestPayload(method); await announceRaw(value.preparedTask);
    expect.soft(f.updateThreadTaskId).not.toHaveBeenCalled(); expect.soft(a.release).not.toHaveBeenCalled();
    expect.soft(ack).not.toHaveBeenCalled(); expect.soft(activeIds()).toEqual(['A']);
    await act(async () => reply.resolve(value));
    expect(ack).toHaveBeenCalledTimes(1); await repeatPrepared(); expect(ack).toHaveBeenCalledTimes(1);
    expect(observers.filter(item => item.taskId === 'B')).toHaveLength(1);
    await act(async () => pending.resolve());
  });

  it.each(['create', 'replace', 'resume'] as const)('U12 older %s event and reply cannot replace ordinary C after C admission has completed', async method => {
    if (method !== 'create') currentGoal = goal();
    const reply = deferred<DesktopGoalMutationResult>(); ({ create, replace, resume }[method]).mockReturnValue(reply.promise);
    f.createTask.mockResolvedValue({ taskId: 'C' }); await mount(); const a = observer('A'); clickSemantic(method);
    const value = requestPayload(method);
    // A's already-written logical result may arrive during the semantic await;
    // this makes ordinary admission reachable even on the old premature-running UI.
    await emit(a, result('A logical response')); fireEvent.click(screen.getByRole('button', { name: 'ordinary submit' }));
    await act(async () => {}); const c = observer('C'); await emit(c, question('C')); const before = visibleState();
    await announceRaw(value.preparedTask); await act(async () => reply.resolve(value));
    expect.soft(visibleState()).toEqual(before); expect.soft(c.release).not.toHaveBeenCalled();
    expect(activeIds()).toEqual(['C']); expect(ack).not.toHaveBeenCalled();
    expect(f.updateThreadTaskId.mock.calls.filter(([, id]) => id === 'B')).toHaveLength(0);
  });

  it.each(['create', 'resume'] as const)('U12 a rejected %s request does not reclassify its later event as automatic', async method => {
    if (method === 'resume') currentGoal = goal();
    const reply = deferred<DesktopGoalMutationResult>(); ({ create, resume }[method]).mockReturnValue(reply.promise);
    await mount(); const a = observer('A'); clickSemantic(method); const value = requestPayload(method);
    await act(async () => reply.reject(new Error('semantic reply lost')));
    const error = screen.getByRole('alert').textContent; await announceRaw(value.preparedTask);
    expect.soft(a.release).not.toHaveBeenCalled(); expect.soft(activeIds()).toEqual(['A']);
    expect(f.updateThreadTaskId).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toBe(error);
  });

  it('U12 repeated resume has different request identities and the old reply cannot borrow the latest attempt', async () => {
    currentGoal = goal(); const first = deferred<DesktopGoalMutationResult>(), second = deferred<DesktopGoalMutationResult>();
    resume.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); await mount();
    clickSemantic('resume'); clickSemantic('resume'); expect(requests).toHaveLength(2);
    expect.soft(requests[0].input.requestId).toEqual(expect.any(String));
    expect.soft(requests[1].input.requestId).not.toBe(requests[0].input.requestId);
    const b = requestPayload('resume', 0), c = requestPayload('resume', 1, 'C');
    await act(async () => second.resolve(c)); const current = observer('C');
    await announceRaw(b.preparedTask); await act(async () => first.resolve(b));
    expect(activeIds()).toEqual(['C']); expect(current.release).not.toHaveBeenCalled(); expect(ack).toHaveBeenCalledTimes(1);
  });

  it.each(['create', 'replace', 'resume'] as const)('U14 %s rejects malformed or unmatched reply identities before IDB/subscribe', async method => {
    // Each bad wire value exercises the real component independently; neither
    // shared parser nor fixture pre-validates the payload on its behalf.
    if (method !== 'create') currentGoal = goal();
    const reply = deferred<DesktopGoalMutationResult>(); ({ create, replace, resume }[method]).mockReturnValue(reply.promise);
    await mount(); const a = observer('A'); clickSemantic(method);
    const value = requestPayload(method); value.preparedTask.attachmentSource = { kind: 'request', requestId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    await act(async () => reply.resolve(value));
    expect.soft(a.release).not.toHaveBeenCalled(); expect(f.updateThreadTaskId).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled(); expect(activeIds()).toEqual(['A']);
  });

  it.each(['missing', 'automatic', 'legacy-null', 'foreign-thread', 'foreign-scope', 'foreign-goal-ref'] as const)
  ('U14 invalid request reply %s cannot become an automatic or current attachment', async invalid => {
    const reply = deferred<DesktopGoalMutationResult>(); create.mockReturnValue(reply.promise); await mount(); const a = observer('A'); createViaDom();
    const value = requestPayload('create');
    if (invalid === 'missing') Reflect.deleteProperty(value.preparedTask, 'attachmentSource');
    if (invalid === 'automatic') value.preparedTask.attachmentSource = { kind: 'automatic', predecessorTaskId: 'A' };
    if (invalid === 'legacy-null') value.preparedTask.attachmentSource = { kind: 'request', requestId: null };
    if (invalid === 'foreign-thread') value.preparedTask.threadId = 'other-thread';
    if (invalid === 'foreign-scope') value.preparedTask.executionScope = { ...value.preparedTask.executionScope, threadId: 'other-thread' };
    if (invalid === 'foreign-goal-ref') value.preparedTask.goalRef.goalId = 'other-goal';
    await act(async () => reply.resolve(value));
    expect.soft(a.release).not.toHaveBeenCalled(); expect(f.updateThreadTaskId).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled(); expect(activeIds()).toEqual(['A']);
  });

  it.each(['legacy-null', 'unowned-uuid'] as const)('U14 request event %s with no reply-created work is inert', async kind => {
    await mount(); const a = observer('A'); const value = prepared();
    value.attachmentSource = { kind: 'request', requestId: kind === 'legacy-null' ? null : 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' };
    await announceRaw(value); expect.soft(a.release).not.toHaveBeenCalled(); expect.soft(screen.queryByRole('alert')).toBeNull();
    expect(f.updateThreadTaskId).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled(); expect(requests).toEqual([]);
  });

  it.each(['live-terminal', 'reload-terminal'] as const)('U13 valid automatic continuation works after %s with UI projection still one revision behind', async route => {
    await mountGoal(route === 'reload-terminal' ? 'completed' : 'running');
    if (route === 'live-terminal') {
      await emit(observer('A'), { type: 'task_terminal', status: 'completed' });
      expect.soft(observer('A').release).toHaveBeenCalledTimes(1);
    }
    await announceRaw(automatic()); expect(ack).toHaveBeenCalledTimes(1);
    expect(activeIds()).toEqual(['B']); expect(screen.getByTestId('display-source')).toHaveTextContent('B'); expect(requests).toEqual([]);
  });

  it('U13 automatic waits for the real initial thread load and accepts its terminal predecessor only after that load resolves', async () => {
    currentGoal = goal(); const read = deferred<ThreadRecord>(); f.getThread.mockReturnValueOnce(read.promise);
    f.recoverTask.mockImplementation(async (id: string) => ({ snapshot: goalSnapshot(id, 'completed') }));
    await mount(false, false); await announceRaw(automatic());
    expect(f.updateThreadTaskId).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled();
    await act(async () => read.resolve(thread()));
    expect(ack).toHaveBeenCalledTimes(1); expect(activeIds()).toEqual(['B']); expect(requests).toEqual([]);
  });

  it.each(['predecessor', 'new-request', 'queue'] as const)('U13 automatic cannot bypass %s conflict while A still occupies the display', async conflict => {
    await mountGoal(); const a = observer('A');
    if (conflict === 'new-request') { resume.mockReturnValue(deferred<DesktopGoalMutationResult>().promise); clickSemantic('resume'); }
    if (conflict === 'queue') fireEvent.click(screen.getByRole('button', { name: 'queue current draft' }));
    await announceRaw(automatic(conflict === 'predecessor' ? 'other-source' : 'A'));
    expect.soft(a.release).not.toHaveBeenCalled(); expect(f.updateThreadTaskId).not.toHaveBeenCalled();
    expect(ack).not.toHaveBeenCalled(); expect(activeIds()).toEqual(['A']);
  });

  it('U13 an automatic callback awaiting initialization cannot outlive navigation', async () => {
    currentGoal = goal(); const read = deferred<ThreadRecord>(); f.getThread.mockReturnValueOnce(read.promise);
    f.recoverTask.mockImplementation(async (id: string) => ({ snapshot: goalSnapshot(id, 'completed') }));
    await mount(false, false); await announceRaw(automatic());
    // Loading has no composer/GoalBar. Navigation is a real surviving parent
    // action, not a fabricated click on a hidden Goal/composer callback.
    fireEvent.click(screen.getByRole('button', { name: 'other thread' }));
    await act(async () => read.resolve(thread())); expect(f.updateThreadTaskId).not.toHaveBeenCalled(); expect(ack).not.toHaveBeenCalled();
  });

  it.each(['getThread', 'recoverTask'] as const)('U13 locale-driven real reload %s await cannot replay A over an already pending semantic reply that promotes B', async stage => {
    const reply = deferred<DesktopGoalMutationResult>(); create.mockReturnValue(reply.promise); await mount(); createViaDom();
    const value = requestPayload('create'), read = deferred<ThreadRecord | { snapshot: TaskSnapshot }>();
    if (stage === 'getThread') f.getThread.mockReturnValueOnce(read.promise); else f.recoverTask.mockReturnValueOnce(read.promise);
    // This parent control is outside ChatShell; changing the real locale changes
    // handleEvent/replaySnapshot dependencies and triggers the actual load effect.
    fireEvent.click(screen.getByRole('button', { name: 'English locale' })); await act(async () => {});
    expect(screen.queryByTestId('display-source')).toBeNull();
    await act(async () => reply.resolve(value));
    const b = observer('B'); await emit(b, question('B')); const before = visibleState();
    const old: TaskSnapshot = { ...snapshot('A'), events: [result('STALE A reload'), { type: 'progress_plan_reported',
      steps: [{ id: 'old', label: 'STALE plan', status: 'running' }] }] };
    await act(async () => read.resolve(stage === 'getThread' ? thread() : { snapshot: old }));
    expect.soft(visibleState()).toEqual(before); expect.soft(activeIds()).toEqual(['B']);
    expect(screen.getByTestId('display-source')).toHaveTextContent('B');
    expect(screen.getByTestId('history')).not.toHaveTextContent('STALE A reload'); expect(screen.getByTestId('plan')).not.toHaveTextContent('STALE plan');
  });
});
afterEach(() => { cleanup(); expect(cancel).not.toHaveBeenCalled(); Reflect.deleteProperty(window, 'xiaokDesktop'); _resetDesktopApiCache(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('W2 actual ChatShell source ownership: no reimplemented handoff or fake main ACK', () => {
  it.each(['idle', 'failed', 'completed'] as const)('U1 create before a reply cannot replace the old %s presentation with running or idle', async status => {
    const pending = deferred<DesktopGoalMutationResult>(); create.mockReturnValue(pending.promise);
    await mount(); const a = observer('A'); await emit(a, status === 'idle' ? result('saved A answer') : status === 'failed' ? { type: 'error', message: 'saved A failure' }
      : { type: 'result', result: { summary: 'saved A delivery', artifacts: [artifact('A-file')] } });
    createViaDom(); expect.soft(screen.getByTestId('display-status')).toHaveTextContent(status);
    await act(async () => pending.reject(new Error('create rejected')));
    expect(screen.getByTestId('display-status')).toHaveTextContent(status);
    expect(a.release).not.toHaveBeenCalled(); expect(screen.getByLabelText('目标')).toHaveValue('new objective draft');
    expect(screen.getByLabelText('chat draft')).toHaveValue('saved draft');
  });

  it.each(['failed', 'completed'] as const)('U1 failed create preserves A latest %s event received during its await, not a captured old state', async terminal => {
    const pending = deferred<DesktopGoalMutationResult>(); create.mockReturnValue(pending.promise);
    await mount(); createViaDom();
    await emit(observer('A'), terminal === 'failed' ? { type: 'error', message: 'A latest failure' }
      : { type: 'result', result: { summary: 'A latest answer', artifacts: [artifact('A-file')] } });
    await act(async () => pending.reject(new Error('create rejected')));
    expect(screen.getByTestId('display-status')).toHaveTextContent(terminal);
  });

  it('U1 update rejection leaves A subscribed and accepts A new events, without B subscribe or ACK', async () => {
    const write = deferred(); f.updateThreadTaskId.mockReturnValue(write.promise); await mount(); const a = observer('A');
    await announce(); expect.soft(a.release).not.toHaveBeenCalled();
    await emit(a, question('A')); await act(async () => write.reject(new Error('IDB transaction abort')));
    expect(a.release).not.toHaveBeenCalled(); expect(activeIds()).toEqual(['A']); expect(ack).not.toHaveBeenCalled();
    expect(screen.getByTestId('question')).toHaveTextContent('A question'); expect(screen.getByTestId('display-status')).toHaveTextContent('waiting_user');
  });

  it('U2 subscription installation throws synchronously after update; A is not lost and no ACK is sent', async () => {
    await mount(); const a = observer('A'); f.subscribeTask.mockImplementationOnce(() => { throw new Error('local listener installation failed'); });
    await announce(); expect(f.updateThreadTaskId).toHaveBeenCalledExactlyOnceWith(threadId, 'B');
    expect(a.release).not.toHaveBeenCalled(); expect(activeIds()).toEqual(['A']); expect(ack).not.toHaveBeenCalled();
    expect(screen.getByTestId('display-source')).toHaveTextContent('A');
  });

  it('U3 update → subscribe → release old observer → ACK and install B before the unresolved ACK', async () => {
    const pending = deferred(); ack.mockImplementation(({ attachmentId }: { attachmentId: string }) => { order.push(`ack:${attachmentId}`); return pending.promise; });
    await mount(); order.length = 0; await announce();
    expect.soft(order).toEqual(['update:B', 'subscribe:B', 'release:A', 'ack:attach-B']);
    expect.soft(screen.getByTestId('display-source')).toHaveTextContent('B'); expect(activeIds()).toEqual(['B']);
    await emit(observer('B'), question('B')); await act(async () => pending.resolve());
    expect(screen.getByTestId('display-status')).toHaveTextContent('waiting_user'); expect(screen.getByTestId('question')).toHaveTextContent('B question');
  });

  const staleEvents: DesktopTaskEvent[] = [
    { type: 'task_started', taskId: 'A' },
    { type: 'progress', message: 'OLD progress', eventId: 'old-progress' },
    { type: 'assistant_delta', delta: 'OLD delta', eventId: 'old-delta' },
    { type: 'error', message: 'OLD error' }, result('OLD result'), question('A', 'OLD question'),
    { type: 'task_cancelled', taskId: 'A', reason: 'old', partialText: 'OLD partial' },
    { type: 'progress_plan_reported', steps: [{ id: 'old', label: 'OLD plan', status: 'running' }] },
    { type: 'canvas_tool_call', toolName: 'Write', input: { file_path: '/tmp/old.html' }, toolUseId: 'old-tool', eventId: 'old-call' },
    { type: 'canvas_tool_result', toolName: 'Write', toolUseId: 'old-tool', ok: false, response: 'OLD response', eventId: 'old-result' },
    { type: 'artifact_recorded', artifactId: 'old-file', kind: 'html', label: 'OLD artifact', filePath: '/tmp/old.html', previewAvailable: true, turnId: 'old-turn' },
    { type: 'task_terminal', status: 'failed' },
  ];
  it.each(staleEvents.map((event, index) => [index, event] as const))('U3/U8 released A queued event %s cannot mutate current B state, history, plan or files', async (_index, event) => {
    await mount(); const a = observer('A'); await announce();
    await emit(observer('B'), { type: 'progress_plan_reported', steps: [{ id: 'B-plan', label: 'B plan', status: 'running' }] });
    await emit(observer('B'), { type: 'result', result: { summary: 'B answer', artifacts: [artifact('B-artifact')] } });
    await emit(observer('B'), question('B')); fireEvent.click(screen.getByRole('button', { name: 'toggle canvas' })); const before = visibleState();
    // A callback was already queued before local release. Do not drop it in
    // this dependency fixture: the real component must reject its source.
    await emit(a, event);
    // Ref-only events such as task_terminal must also be rejected before they
    // enter Canvas history; a later unrelated render exposes that actual ref.
    fireEvent.change(screen.getByLabelText('chat draft'), { target: { value: 'unrelated next render' } });
    expect(visibleState()).toEqual(before);
  });

  it.each(['async', 'sync'] as const)('U4 %s ACK transport failure keeps B, reads its snapshot once and never retries the same attachment', async mode => {
    const pending = deferred(); ack.mockImplementation(() => { if (mode === 'sync') throw new Error('ACK reply lost'); return pending.promise; });
    await mount(); await announce();
    if (mode === 'async') await act(async () => pending.reject(new Error('ACK reply lost')));
    expect.soft(observer('B').release).not.toHaveBeenCalled(); expect.soft(screen.getByTestId('display-source')).toHaveTextContent('B');
    expect.soft(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(1);
    await repeatPrepared(); expect(ack).toHaveBeenCalledTimes(1); expect(activeIds()).toEqual(['B']);
  });

  it.each(['running', 'waiting_user', 'completed', 'failed', 'cancelled', 'understanding', 'reject', 'unconfirmed', 'wrong-task', 'wrong-scope'] as const)
  ('U5 ACK unknown consumes exactly one read allowance for %s without treating query failure as permission to replay', async outcome => {
    const read = deferred<{ snapshot: TaskSnapshot }>(); ack.mockRejectedValue(new Error('ACK reply lost'));
    f.recoverTask.mockImplementation((id: string) => id === 'B' ? read.promise : Promise.resolve({ snapshot: snapshot(id) }));
    await mount(); await announce();
    expect.soft(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(1);
    await act(async () => {
      if (outcome === 'reject' || outcome === 'unconfirmed') read.reject(new Error(outcome === 'reject' ? 'transport read failed' : 'multi_agent_recovery_unconfirmed'));
      else {
        const status = outcome === 'wrong-task' || outcome === 'wrong-scope' ? 'running' : outcome;
        const value = snapshot(outcome === 'wrong-task' ? 'C' : 'B', status, status === 'waiting_user' ? [question('B', 'earlier question'), question('B')] : []);
        if (outcome === 'wrong-scope') value.executionScope = { ...prepared('B').executionScope, epoch: 2 };
        read.resolve({ snapshot: value });
      }
    });
    if (['running', 'waiting_user', 'completed', 'failed'].includes(outcome)) expect.soft(screen.getByTestId('display-status')).toHaveTextContent(outcome);
    if (outcome === 'waiting_user') expect.soft(screen.getByTestId('question')).toHaveTextContent('B question');
    if (['understanding', 'reject', 'unconfirmed', 'wrong-task', 'wrong-scope'].includes(outcome)) {
      expect.soft(screen.getByRole('alert')).toHaveTextContent('任务附着结果尚未确认');
      expect.soft(screen.getByTestId('display-status')).not.toHaveTextContent('running');
    }
    expect.soft(observer('B').release).not.toHaveBeenCalled();
    await repeatPrepared(); expect(ack).toHaveBeenCalledTimes(1); expect(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(1);
  });

  it.each(['waiting_user', 'completed'] as const)('U6 a %s event wins over a running snapshot captured before the event', async status => {
    const read = deferred<{ snapshot: TaskSnapshot }>(); ack.mockRejectedValue(new Error('ACK reply lost'));
    f.recoverTask.mockImplementation((id: string) => id === 'B' ? read.promise : Promise.resolve({ snapshot: snapshot(id) }));
    await mount(); await announce(); const b = observer('B');
    if (status === 'waiting_user') await emit(b, question('B'));
    else { await emit(b, result('B final answer')); await emit(b, { type: 'task_terminal', status: 'completed' }); }
    await act(async () => read.resolve({ snapshot: snapshot('B') }));
    expect(screen.getByTestId('display-status')).toHaveTextContent(status);
    if (status === 'waiting_user') expect(screen.getByTestId('question')).toHaveTextContent('B question');
    expect(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(1);
  });

  it('U6 C only becomes an update candidate and fails: B observer survives B late ACK without clearing C feedback', async () => {
    const bAck = deferred(), cWrite = deferred(); ack.mockReturnValueOnce(bAck.promise);
    await mount(); await announce(); const b = observer('B'); f.updateThreadTaskId.mockReturnValueOnce(cWrite.promise);
    await announce(prepared('C')); await act(async () => cWrite.reject(new Error('C update failure')));
    await act(async () => bAck.reject(new Error('B ACK reply lost')));
    expect.soft(activeIds()).toEqual(['B']); expect.soft(b.release).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('C update failure'); expect(screen.getByTestId('display-source')).toHaveTextContent('B');
  });

  it.each(['resolve', 'reject'] as const)('U6 C really promotes while B ACK is pending: B late %s cannot overwrite or release C', async outcome => {
    const bAck = deferred(); ack.mockReturnValueOnce(bAck.promise); await mount(); await announce(); const b = observer('B');
    await announce(prepared('C')); await emit(observer('C'), question('C')); const before = visibleState();
    await act(async () => outcome === 'resolve' ? bAck.resolve() : bAck.reject(new Error('old B ACK failure')));
    expect.soft(visibleState()).toEqual(before); expect.soft(activeIds()).toEqual(['C']);
    expect(b.release).toHaveBeenCalledTimes(1); expect(observer('C').release).not.toHaveBeenCalled();
    await emit(b, { type: 'error', message: 'old B queued failure' }); expect(visibleState()).toEqual(before);
  });

  it.each(['resolve', 'reject'] as const)('U7 A result file-read %s after B promotion cannot open Canvas or install old content', async outcome => {
    const read = deferred<{ content: string }>(); f.readFileContent.mockReturnValue(read.promise);
    await mount(); const a = observer('A');
    await emit(a, { type: 'canvas_tool_call', toolName: 'Write', input: { file_path: '/tmp/A.html' }, toolUseId: 'A-write', eventId: 'A-call' });
    await emit(a, result('A saved report')); expect(f.readFileContent).toHaveBeenCalledTimes(1);
    await announce(); f.setCollapsed.mockClear();
    await act(async () => outcome === 'resolve' ? read.resolve({ content: 'STALE A HTML' }) : read.reject(new Error('A old file missing')));
    expect(screen.getByTestId('canvas-visible')).toHaveTextContent('false');
    expect(screen.queryByTestId('canvas-preview')).toBeNull(); expect(f.setCollapsed).not.toHaveBeenCalled();
  });

  it('U7 an old queued RAF cannot render the old buffer after synchronous promotion', async () => {
    const frames: FrameRequestCallback[] = []; vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn()); await mount();
    await emit(observer('A'), { type: 'assistant_delta', delta: 'A partial before handoff', eventId: 'A-delta' });
    expect(frames).toHaveLength(1); await announce();
    await act(async () => frames[0](performance.now()));
    expect(screen.getByTestId('stream')).not.toHaveTextContent('A partial before handoff');
    expect(screen.getByTestId('history').textContent?.match(/A partial before handoff/g)).toHaveLength(1);
  });

  it('U7 an already queued old throttle-timer callback cannot schedule a new RAF after source replacement', async () => {
    await mount();
    const now = vi.spyOn(performance, 'now').mockReturnValue(100), frames: FrameRequestCallback[] = [], timers: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.push(callback); return frames.length; }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    const schedule = globalThis.setTimeout;
    vi.spyOn(globalThis, 'setTimeout').mockImplementation((callback, delay, ...args) => {
      if (typeof callback === 'function' && delay === 80) {
        timers.push(() => callback(...args));
        // Own just this scheduled callback, not React's/global fake clock.
        return schedule(() => {}, 0);
      }
      return schedule(callback, delay, ...args);
    });
    const a = observer('A'); await emit(a, { type: 'assistant_delta', delta: 'A first', eventId: 'first' });
    await act(async () => frames[0](100)); await emit(a, { type: 'assistant_delta', delta: ' A tail', eventId: 'second' });
    expect(timers).toHaveLength(1); await announce(); now.mockReturnValue(181);
    // A timer callback can already be queued even when clearTimeout succeeds.
    // Run the original production callback, not a copy of the flush policy.
    await act(async () => timers[0]()); expect(frames).toHaveLength(1);
  });

  it.each(['create', 'replace', 'resume'] as const)('U8 real %s DOM entrance transfers before ACK and late reply cannot revive a terminal B', async entrance => {
    if (entrance !== 'create') currentGoal = goal();
    const pending = deferred(); ack.mockReturnValue(pending.promise); await mount();
    if (entrance === 'create') createViaDom();
    else if (entrance === 'replace') {
      fireEvent.click(screen.getByRole('button', { name: '新建目标' })); createViaDom();
    } else fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await act(async () => {}); const b = observer('B');
    expect.soft(screen.getByTestId('display-source')).toHaveTextContent('B');
    await emit(b, result('B terminal answer')); await emit(b, { type: 'task_terminal', status: 'completed' });
    await act(async () => pending.resolve());
    expect(screen.getByTestId('display-status')).toHaveTextContent('completed');
    expect(screen.getByTestId('history')).toHaveTextContent('B terminal answer'); expect(b.release).toHaveBeenCalledTimes(1);
  });

  it('U8 ordinary submit uses the same source fence and does not accept old A events', async () => {
    await mount(); const a = observer('A'); await emit(a, result('A ordinary answer'));
    fireEvent.click(screen.getByRole('button', { name: 'ordinary submit' })); await act(async () => {});
    const b = observer('ordinary-B'); await emit(b, question('ordinary-B')); const before = visibleState();
    await emit(a, { type: 'error', message: 'old ordinary source' }); expect(visibleState()).toEqual(before); expect(activeIds()).toEqual(['ordinary-B']);
  });

  it('U8 same task string loaded again under a later route generation rejects the old captured callback', async () => {
    await mount(); const old = observer('A'); fireEvent.click(screen.getByRole('button', { name: 'other thread' }));
    await act(async () => {}); fireEvent.click(screen.getByRole('button', { name: 'original thread' })); await act(async () => {});
    const current = observer('A'); expect(current).not.toBe(old); await emit(current, question('A', 'new generation question')); const before = visibleState();
    await emit(old, { type: 'error', message: 'same task old generation error' }); expect(visibleState()).toEqual(before);
  });

  it('U9 result/error/cancelled events retain observation until the actual terminal event, then release once', async () => {
    await mount(); await announce(); const b = observer('B');
    await emit(b, result('B logical result')); await emit(b, { type: 'error', message: 'B delivery failed' });
    await emit(b, { type: 'task_cancelled', taskId: 'B', reason: 'user' });
    expect(b.release).not.toHaveBeenCalled();
    await emit(b, { type: 'task_terminal', status: 'failed' }); expect(b.release).toHaveBeenCalledTimes(1);
    await emit(b, { type: 'task_terminal', status: 'failed' }); expect(b.release).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('U9 unmount with strict=%s releases the active subscription once and never cancels its task', async strict => {
    const view = await mount(strict); await announce(); const b = observer('B');
    view.unmount(); expect(b.release).toHaveBeenCalledTimes(1); expect(activeIds()).toEqual([]);
  });

  it('U10 handoff archives A existing result exactly once and B result contains only B artifacts', async () => {
    await mount(); await emit(observer('A'), { type: 'result', result: { summary: 'A archived delivery', artifacts: [artifact('A-artifact')] } });
    await announce(); expect.soft(screen.getByTestId('current-result')).not.toHaveTextContent('A-artifact');
    expect.soft(screen.getByTestId('history').textContent?.match(/A archived delivery/g)).toHaveLength(1);
    await emit(observer('B'), { type: 'result', result: { summary: 'B delivery', artifacts: [artifact('B-artifact')] } });
    expect(screen.getByTestId('current-result')).not.toHaveTextContent('A-artifact');
  });

  it('U10 a plain A result already rendered in history is not archived a second time on Goal handoff', async () => {
    await mount(); await emit(observer('A'), result('A plain unique answer'));
    await announce();
    expect(screen.getByTestId('history').textContent?.match(/A plain unique answer/g)).toHaveLength(1);
  });

  it('U10 a result card already recovered from the real replay path is not inserted again when Goal B promotes', async () => {
    f.recoverTask.mockImplementation(async (id: string) => ({ snapshot: snapshot(id, 'running', id === 'A'
      ? [{ type: 'result', result: { summary: 'A recovered card', artifacts: [artifact('A-recovered-file')] } }] : []) }));
    await mount();
    const cards = () => JSON.parse(screen.getByTestId('history').textContent ?? '[]').filter((message: { role: string }) => message.role === 'result_card');
    expect(cards()).toHaveLength(1); await announce();
    expect(cards()).toHaveLength(1); expect(screen.getByTestId('current-result')).not.toHaveTextContent('A-recovered-file');
  });

  it.each(['answer', 'cancel'] as const)('U8 old A %s reply cannot overwrite B waiting state after real handoff', async action => {
    const pending = deferred(); (action === 'answer' ? f.answerQuestion : f.cancelTask).mockReturnValue(pending.promise);
    await mount(); const a = observer('A');
    if (action === 'answer') {
      await emit(a, { type: 'needs_user', question: { taskId: 'A', questionId: 'A-choice', kind: 'confirm_understanding', prompt: 'A choice', choices: [{ id: 'yes', label: 'answer A' }] } });
      fireEvent.click(screen.getByRole('button', { name: 'answer A' }));
      expect(f.answerQuestion).toHaveBeenCalledExactlyOnceWith({ taskId: 'A', answer: { questionId: 'A-choice', type: 'choice', choiceId: 'yes' } });
    } else {
      fireEvent.click(screen.getByRole('button', { name: 'stop current task' }));
      expect(f.cancelTask).toHaveBeenCalledExactlyOnceWith('A');
    }
    await announce(); const b = observer('B'); await emit(b, question('B')); const before = visibleState();
    await act(async () => pending.resolve());
    expect(visibleState()).toEqual(before); expect(activeIds()).toEqual(['B']); expect(b.release).not.toHaveBeenCalled();
  });

  it.each([['answer', false], ['cancel', false], ['answer', true], ['cancel', true]] as const)
  ('U8 current A %s success keeps original behavior when a failed candidate exists=%s but no handoff', async (action, failedCandidate) => {
    const pending = deferred(); (action === 'answer' ? f.answerQuestion : f.cancelTask).mockReturnValue(pending.promise);
    await mount();
    if (action === 'answer') {
      await emit(observer('A'), { type: 'needs_user', question: { taskId: 'A', questionId: 'A-choice', kind: 'confirm_understanding', prompt: 'A choice', choices: [{ id: 'yes', label: 'answer A' }] } });
      fireEvent.click(screen.getByRole('button', { name: 'answer A' }));
    } else fireEvent.click(screen.getByRole('button', { name: 'stop current task' }));
    if (failedCandidate) { f.updateThreadTaskId.mockRejectedValueOnce(new Error('candidate rejected')); await announce(); }
    await act(async () => pending.resolve());
    expect(screen.getByTestId('display-status')).toHaveTextContent(action === 'answer' ? 'running' : 'idle');
    if (action === 'answer') expect(screen.getByTestId('question')).toBeEmptyDOMElement();
    expect(activeIds()).toEqual(['A']); expect(observer('A').release).not.toHaveBeenCalled();
  });

  it.each(['answer', 'cancel'] as const)('U8 A %s reply cannot overwrite its own newer actual terminal fact', async action => {
    const pending = deferred(); (action === 'answer' ? f.answerQuestion : f.cancelTask).mockReturnValue(pending.promise);
    await mount(); const a = observer('A');
    if (action === 'answer') {
      await emit(a, { type: 'needs_user', question: { taskId: 'A', questionId: 'A-choice', kind: 'confirm_understanding', prompt: 'A choice', choices: [{ id: 'yes', label: 'answer A' }] } });
      fireEvent.click(screen.getByRole('button', { name: 'answer A' }));
    } else fireEvent.click(screen.getByRole('button', { name: 'stop current task' }));
    await emit(a, { type: 'task_terminal', status: 'completed' });
    await act(async () => pending.resolve());
    expect(screen.getByTestId('display-status')).toHaveTextContent('completed'); expect(a.release).toHaveBeenCalledTimes(1);
  });

  it.each(['kind', 'origin', 'threadId', 'goalId', 'epoch', 'goalTurnId'] as const)('U5 unknown readback with mismatched %s cannot adopt a running snapshot', async field => {
    ack.mockRejectedValue(new Error('ACK reply lost'));
    f.recoverTask.mockImplementation(async (id: string) => {
      const value = snapshot(id);
      if (id === 'B') value.executionScope = field === 'kind'
        ? { kind: 'artifact_workspace_generation', generationRequestId: 'different', leaseId: 'different' }
        : { ...prepared().executionScope, [field]: field === 'epoch' ? 2 : field === 'origin' ? 'user' : 'different' };
      return { snapshot: value };
    });
    await mount(); await announce();
    expect.soft(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(1);
    expect.soft(screen.getByRole('alert')).toHaveTextContent('任务附着结果尚未确认');
    expect.soft(screen.getByTestId('display-status')).not.toHaveTextContent('running');
    await repeatPrepared(); expect(ack).toHaveBeenCalledTimes(1); expect(activeIds()).toEqual(['B']);
  });

  it('U5 terminal readback preserves the original observer for older replay content, but not activity/question/automatic Canvas resurrection', async () => {
    ack.mockRejectedValue(new Error('ACK reply lost'));
    f.recoverTask.mockImplementation(async (id: string) => ({ snapshot: snapshot(id, id === 'B' ? 'failed' : 'running') }));
    await mount(); await announce(); const b = observer('B');
    expect.soft(screen.getByTestId('display-status')).toHaveTextContent('failed'); expect.soft(b.release).not.toHaveBeenCalled();
    await emit(b, { type: 'progress', message: 'replay progress', eventId: 'replay-progress' });
    await emit(b, question('B', 'obsolete replay question'));
    await emit(b, { type: 'canvas_tool_call', toolName: 'Write', input: { file_path: '/tmp/B.html' }, toolUseId: 'B-write', eventId: 'B-call' });
    await emit(b, result('B saved replay answer')); await emit(b, { type: 'error', message: 'B saved replay error' });
    expect.soft(screen.getByTestId('history')).toHaveTextContent('B saved replay answer');
    expect.soft(screen.getByTestId('history')).toHaveTextContent('B saved replay error');
    expect.soft(screen.getByTestId('display-status')).toHaveTextContent('failed');
    expect.soft(screen.getByTestId('question')).toBeEmptyDOMElement(); expect.soft(f.readFileContent).not.toHaveBeenCalled();
    expect.soft(screen.getByTestId('canvas-visible')).toHaveTextContent('false');
    await emit(b, { type: 'task_terminal', status: 'failed' }); expect(b.release).toHaveBeenCalledTimes(1);
  });

  it.each(['create', 'replace', 'resume'] as const)('U6 older %s reply/catch/finally cannot overwrite newer Goal feedback or finish its pending form', async entrance => {
    if (entrance !== 'create') currentGoal = goal('previous');
    const oldReply = deferred<DesktopGoalMutationResult>(), newReply = deferred<DesktopGoalMutationResult>();
    ({ create, replace, resume }[entrance]).mockReturnValueOnce(oldReply.promise);
    resume.mockReturnValueOnce(newReply.promise);
    await mount();
    if (entrance === 'create') createViaDom();
    else if (entrance === 'replace') { fireEvent.click(screen.getByRole('button', { name: '新建目标' })); createViaDom(); }
    else fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    // The old operation's main work may have settled while its transport
    // reply is delayed; a newer authoritative Goal projection is permitted.
    await changed(goal('goal-C')); await announce(prepared('C'));
    fireEvent.click(screen.getByRole('button', { name: '恢复' })); await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '新建目标' }));
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'C pending form draft' } });
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
    await act(async () => oldReply.reject(new Error('OLD B transport rejection')));
    expect.soft(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
    expect.soft(screen.queryByRole('alert')).toBeNull();
    expect.soft(screen.getByTestId('display-source')).toHaveTextContent('C');
    await act(async () => newReply.reject(new Error('C current failure')));
    expect(screen.getByRole('alert')).toHaveTextContent('C current failure');
    expect(screen.getByLabelText('目标')).toHaveValue('C pending form draft');
  });

  it.each(['create', 'replace', 'resume'] as const)('U6 older %s success after C promotion cannot publish B Goal or create B observer', async entrance => {
    if (entrance !== 'create') currentGoal = goal('previous');
    const oldReply = deferred<DesktopGoalMutationResult>(); ({ create, replace, resume }[entrance]).mockReturnValueOnce(oldReply.promise);
    await mount();
    if (entrance === 'create') createViaDom();
    else if (entrance === 'replace') { fireEvent.click(screen.getByRole('button', { name: '新建目标' })); createViaDom(); }
    else fireEvent.click(screen.getByRole('button', { name: '恢复' }));
    await changed(goal('goal-C')); await announce(prepared('C')); await emit(observer('C'), question('C'));
    await act(async () => oldReply.resolve(replyFor(requests[0].input, prepared('B', 'attach-B', entrance === 'resume' ? 'continuation' : 'user'))));
    expect.soft(screen.getByTestId('display-source')).toHaveTextContent('C');
    expect.soft(screen.getByTestId('display-status')).toHaveTextContent('waiting_user');
    expect.soft(screen.queryByText('objective goal-C')).not.toBeNull();
    expect(activeIds()).toEqual(['C']); expect(ack.mock.calls.filter(([input]) => input.attachmentId === 'attach-B')).toHaveLength(0);
  });

  it('U8 prepared event and successful create reply identify one attachment, producing one observer and one ACK', async () => {
    const reply = deferred<DesktopGoalMutationResult>(), pending = deferred(); create.mockReturnValue(reply.promise); ack.mockReturnValue(pending.promise);
    await mount(); createViaDom();
    const payload = replyFor(requests[0].input, prepared('B', 'attach-B', 'user'));
    await announceRaw(payload.preparedTask);
    await act(async () => reply.resolve(payload));
    await repeatPrepared();
    expect(ack).toHaveBeenCalledTimes(1); expect(observers.filter(value => value.taskId === 'B')).toHaveLength(1);
    await act(async () => pending.resolve()); expect(activeIds()).toEqual(['B']);
  });

  it('U9 navigation during unresolved ACK releases B once; its late failure cannot touch the new draft or retry/read old B', async () => {
    const pending = deferred(); ack.mockReturnValue(pending.promise); await mount(); await announce(); const b = observer('B');
    fireEvent.click(screen.getByRole('button', { name: 'other thread' })); await act(async () => {});
    await act(async () => pending.reject(new Error('old route reply lost')));
    expect(b.release).toHaveBeenCalledTimes(1); expect(activeIds()).toEqual([]);
    expect(screen.getByLabelText('chat draft')).toHaveValue('other draft'); expect(screen.queryByRole('alert')).toBeNull();
    expect(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(0);
  });

  it('U2 defensive dependency contract: synchronous owner unmount during listener installation releases only that candidate and never ACKs it', async () => {
    const mounted = await mount(); const original = f.subscribeTask.getMockImplementation()!;
    f.subscribeTask.mockImplementationOnce((id: string, handler: (event: DesktopTaskEvent) => void) => {
      const release = original(id, handler);
      // Exercise the frozen synchronous-dependency contract with a real root
      // teardown, not a fabricated isCurrent predicate. The production preload
      // does not normally navigate here; this is not an IPC-microtask race.
      mounted.unmount();
      return release;
    });
    await announce();
    expect.soft(ack).not.toHaveBeenCalled(); expect(observer('B').release).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText('chat draft')).toBeNull(); expect(activeIds()).toEqual([]);
  });

  it('U3 defensive dependency contract: synchronous B callback before subscription returns cannot write A or be buffered for later', async () => {
    const pending = deferred(); ack.mockReturnValue(pending.promise); await mount(); const original = f.subscribeTask.getMockImplementation()!;
    f.subscribeTask.mockImplementationOnce((id: string, handler: (event: DesktopTaskEvent) => void) => {
      handler({ type: 'error', message: 'candidate callback before promote' });
      return original(id, handler);
    });
    await announce(); expect.soft(screen.getByTestId('history')).not.toHaveTextContent('candidate callback before promote');
    await act(async () => pending.resolve());
    expect(screen.getByTestId('history')).not.toHaveTextContent('candidate callback before promote');
    expect(activeIds()).toEqual(['B']);
  });

  it.each(['old', 'null', 'reject'] as const)('U6 initial getGoal %s arriving after a new attempt cannot overwrite its projection, error or loading', async outcome => {
    const initial = deferred<DesktopGoalProjection | null>(), pending = deferred<DesktopGoalMutationResult>();
    vi.mocked(window.xiaokDesktop.getGoal).mockReturnValueOnce(initial.promise); resume.mockReturnValue(pending.promise);
    await mount(); await changed(goal('goal-C')); await announce(prepared('C'));
    fireEvent.click(screen.getByRole('button', { name: '恢复' })); await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: '新建目标' }));
    fireEvent.change(screen.getByLabelText('目标'), { target: { value: 'C pending draft' } });
    expect(screen.getByRole('button', { name: '确认创建' })).toBeDisabled();
    await act(async () => outcome === 'reject' ? initial.reject(new Error('OLD initial getGoal failure')) : initial.resolve(outcome === 'old' ? goal('OLD') : null));
    expect.soft(screen.queryByRole('alert')).toBeNull();
    expect.soft(screen.queryByRole('button', { name: '确认创建' })).toBeDisabled();
    expect.soft(screen.getByLabelText('目标')).toHaveValue('C pending draft');
    await act(async () => pending.reject(new Error('C current rejection')));
    expect(screen.getByRole('alert')).toHaveTextContent('C current rejection');
  });

  it('U6 onGoalChanged lower revision of the same Goal cannot overwrite its newer projection', async () => {
    await mount(); await changed(goal('goal-B', 3));
    const obsolete = goal('goal-B', 2); obsolete.state.objective = 'OBSOLETE goal revision';
    await changed(obsolete);
    expect(screen.queryByText('OBSOLETE goal revision')).toBeNull(); expect(screen.getByText('objective goal-B')).toBeInTheDocument();
  });

  it('U8 an actual prepared-event continuation has the same pre-ACK source transfer and keeps an early waiting event', async () => {
    currentGoal = goal();
    f.recoverTask.mockImplementation(async (id: string) => ({ snapshot: { ...snapshot(id), executionScope: {
      kind: 'goal_turn', origin: 'user', threadId, goalId: 'goal-B', epoch: 1, goalTurnId: 'turn-A' } } }));
    const pending = deferred(); ack.mockReturnValue(pending.promise); await mount();
    await announceRaw({ ...prepared('B', 'continuation-B', 'continuation'), attachmentSource: { kind: 'automatic', predecessorTaskId: 'A' } });
    const b = observer('B');
    expect.soft(screen.getByTestId('display-source')).toHaveTextContent('B');
    await emit(b, question('B')); await act(async () => pending.resolve());
    expect(screen.getByTestId('display-status')).toHaveTextContent('waiting_user'); expect(activeIds()).toEqual(['B']);
    expect(create).not.toHaveBeenCalled(); expect(replace).not.toHaveBeenCalled(); expect(resume).not.toHaveBeenCalled();
  });

  it.each(['resolve', 'reject'] as const)('U6 B readback late %s after C promotion never changes C or issues another read', async outcome => {
    const read = deferred<{ snapshot: TaskSnapshot }>(); ack.mockRejectedValueOnce(new Error('B ACK reply lost'));
    f.recoverTask.mockImplementation((id: string) => id === 'B' ? read.promise : Promise.resolve({ snapshot: snapshot(id) }));
    await mount(); await announce(); expect.soft(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(1);
    await changed(goal('goal-C')); await announce(prepared('C')); await emit(observer('C'), question('C')); const before = visibleState();
    await act(async () => outcome === 'resolve' ? read.resolve({ snapshot: snapshot('B', 'failed') }) : read.reject(new Error('OLD B query failure')));
    expect.soft(visibleState()).toEqual(before); expect.soft(activeIds()).toEqual(['C']);
    expect(screen.queryByRole('alert')).toBeNull(); expect(f.recoverTask.mock.calls.filter(([id]) => id === 'B')).toHaveLength(1);
  });

  it('U8 a new ordinary Chat after Goal B logical result supersedes B source even while B host terminal is pending', async () => {
    await mount(); await announce(); const b = observer('B'); await emit(b, result('B logical answer'));
    fireEvent.click(screen.getByRole('button', { name: 'ordinary submit' })); await act(async () => {});
    await emit(observer('ordinary-B'), question('ordinary-B')); const before = visibleState();
    await emit(b, { type: 'error', message: 'B late delivery error' }); expect(visibleState()).toEqual(before);
    expect(activeIds()).toEqual(['ordinary-B']);
  });

  it.each([
    ['pauseGoal', '暂停', 'resolve'], ['pauseGoal', '暂停', 'reject'],
    ['cancelGoal', '取消目标', 'resolve'], ['cancelGoal', '取消目标', 'reject'],
  ] as const)('U6 shared feedback sibling %s late %s/%s cannot clear the next source or its Goal feedback', async (method, label, outcome) => {
    currentGoal = { ...goal('previous'), activation: 'armed' };
    const reply = deferred<DesktopGoalProjection>();
    Object.assign(window.xiaokDesktop, { [method]: vi.fn(() => reply.promise) });
    await mount(); fireEvent.click(screen.getByRole('button', { name: label }));
    await changed(goal('goal-C')); await announce(prepared('C')); await emit(observer('C'), question('C'));
    const before = visibleState();
    const old = goal('previous'); old.state.status = method === 'pauseGoal' ? 'paused' : 'cancelled';
    await act(async () => outcome === 'resolve' ? reply.resolve(old) : reply.reject(new Error('old mutation error')));
    expect.soft(visibleState()).toEqual(before); expect.soft(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText('objective goal-C')).not.toBeNull(); expect(activeIds()).toEqual(['C']);
  });
});
