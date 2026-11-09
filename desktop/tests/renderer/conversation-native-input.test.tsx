import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {MemoryRouter} from 'react-router-dom';
import {LocaleProvider} from '../../renderer/src/contexts/LocaleContext';
import {ConversationActivityPanel} from '../../renderer/src/components/ConversationActivityPanel';
import {questionOutsideNativeActivity} from '../../renderer/src/components/NativeWorkControls';
import type {NeedsUserQuestion} from '../../../src/runtime/task-host/types';
const api=vi.hoisted(()=>({list:vi.fn(),work:vi.fn(),forms:vi.fn(),answer:vi.fn(),subscribe:vi.fn(),read:vi.fn()}));
vi.mock('../../renderer/src/shared/desktop',()=>({getDesktopApi:()=>({getConversationActivities:api.list,getWorkActivity:api.work,getNativeActivityQuestions:api.forms,answerNativeActivityQuestion:api.answer,subscribeConversationActivities:api.subscribe,markConversationActivitiesRead:api.read})}));
const form=(id:string)=>({questionRef:'native-question:'+id,questionId:id,expectedDigest:id.repeat(64),sourceRevision:1,prompt:'<img src=x> Question '+id,choices:['approve','deny']});
const view=(watchId='watch')=>({questionSourceKind:'codex_native_approval',watch:{watchId,workId:'native-task',source:'task_host',sourceDataEpoch:'task-session',origin:{threadId:'thread'},status:'active',preference:'quiet',policyRevision:0},projection:{watchId,executionState:'blocked',businessOutcome:'unknown',freshness:'fresh',revision:1,lastProgressAt:null,lastHeartbeatAt:null,summary:'Independent authorization remains blocked.'},presentation:{freshness:'fresh',protocolUnavailable:false,anchorFactId:'anchor',questions:[{questionRef:form('a').questionRef},{questionRef:form('b').questionRef}],reasons:[{code:'authorization_required',severity:'blocking'}]}});
let changed:()=>void;
beforeEach(()=>{api.list.mockResolvedValue([{watchId:'watch',localSeq:1,kind:'blocked'}]);api.work.mockImplementation(async(id:string)=>view(id));api.forms.mockResolvedValue([form('a'),form('b')]);api.answer.mockResolvedValue(undefined);api.subscribe.mockImplementation((_thread,callback)=>{changed=callback;return()=>{};});api.read.mockResolvedValue(undefined);});
afterEach(()=>{cleanup();vi.resetAllMocks();});
function mount(threadId='thread'){return render(<MemoryRouter><LocaleProvider><textarea aria-label="draft" defaultValue={'中文\n草稿'}/><ConversationActivityPanel threadId={threadId}/></LocaleProvider></MemoryRouter>);}
it('shows every Native question alongside independent blocking facts, escapes source text, and answers only one explicit choice',async()=>{
  const{container}=mount();screen.getByLabelText('draft').focus();
  expect(await screen.findByText(form('a').prompt)).toBeVisible();expect(screen.getByText(form('b').prompt)).toBeVisible();
  expect(screen.getByTestId('activity-safety-facts')).toHaveTextContent(/需要确认授权|Authorization/);expect(screen.getByTestId('activity-toggle')).toHaveAttribute('aria-expanded','true');
  expect(screen.getByLabelText('draft')).toHaveFocus();expect(container.querySelector('img')).toBeNull();expect(api.answer).not.toHaveBeenCalled();
  api.forms.mockResolvedValue([form('b')]);
  fireEvent.click(within(screen.getByTestId('native-question-'+form('a').questionRef)).getByRole('button',{name:/拒绝|Deny/}));
  await waitFor(()=>expect(api.answer).toHaveBeenCalledWith({watchId:'watch',questionRef:form('a').questionRef,expectedDigest:form('a').expectedDigest,choiceId:'deny'}));
  await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());expect(screen.getByText(form('b').prompt)).toBeVisible();expect(screen.getByText('Independent authorization remains blocked.')).toBeVisible();expect(screen.getByLabelText('draft')).toHaveValue('中文\n草稿');
});
it('deduplicates aliases and locks an in-flight question across refreshes without resending an accepted answer',async()=>{
  api.list.mockResolvedValue([{watchId:'watch',localSeq:1},{watchId:'alias',localSeq:2}]);let release!:()=>void;api.answer.mockImplementation(()=>new Promise<void>(resolve=>{release=resolve;}));
  mount();await screen.findByText(form('a').prompt);expect(screen.getAllByText(form('a').prompt)).toHaveLength(1);
  const question=screen.getByTestId('native-question-'+form('a').questionRef);fireEvent.click(within(question).getByRole('button',{name:/允许一次|Allow once/}));fireEvent.click(within(question).getByRole('button',{name:/允许一次|Allow once/}));
  await act(async()=>{changed();});await waitFor(()=>expect(api.forms.mock.calls.length).toBeGreaterThan(2));expect(within(screen.getByTestId('native-question-'+form('a').questionRef)).getByRole('button',{name:/允许一次|Allow once/})).toBeDisabled();expect(api.answer).toHaveBeenCalledOnce();
  await act(async()=>{release();});await waitFor(()=>expect(within(screen.getByTestId('native-question-'+form('a').questionRef)).getByRole('button',{name:/允许一次|Allow once/})).toBeDisabled());expect(api.answer).toHaveBeenCalledOnce();
});
it('clears a denied inventory and never restores an older held successful read',async()=>{
  mount();await screen.findByText(form('a').prompt);let release!:(value:unknown)=>void;
  api.forms.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));await act(async()=>{changed();});await waitFor(()=>expect(release).toBeTypeOf('function'));
  api.forms.mockRejectedValue(Error('activity_source_forbidden'));await act(async()=>{changed();});await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());
  await act(async()=>{release([form('a'),form('b')]);});expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument();expect(api.answer).not.toHaveBeenCalled();
  expect(screen.queryByText('Independent authorization remains blocked.')).not.toBeInTheDocument();
});
it('reports exact current coverage and distinguishes unavailable fallback from a forbidden source',async()=>{
  const coverage=vi.fn();render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" onNativeCoverage={coverage}/></LocaleProvider></MemoryRouter>);
  await screen.findByText(form('a').prompt);expect(coverage).toHaveBeenLastCalledWith({threadId:'thread',forbiddenScopes:[],questions:[{taskId:'native-task',taskSessionId:'task-session',questionId:'a'},{taskId:'native-task',taskSessionId:'task-session',questionId:'b'}]});
  api.forms.mockRejectedValue(Error('activity_native_source_unsupported'));await act(async()=>{changed();});await waitFor(()=>expect(coverage).toHaveBeenLastCalledWith({threadId:'thread',forbiddenScopes:[],questions:[]}));
  api.forms.mockRejectedValue(Error('activity_source_forbidden'));await act(async()=>{changed();});await waitFor(()=>expect(coverage).toHaveBeenLastCalledWith({threadId:'thread',forbiddenScopes:[{taskId:'native-task',taskSessionId:'task-session'}],questions:[]}));
});
it('hides only the exact covered Native question and never revives its old card on source denial',()=>{
  const question={questionId:'a',taskId:'native-task',kind:'assumption_approval',prompt:'Original question',owner:{schemaVersion:1,kind:'codex_native_approval',taskSessionId:'task-session',approvalToken:'a'}} as NeedsUserQuestion;
  const coverage={threadId:'thread',forbiddenScopes:[],questions:[{taskId:'native-task',taskSessionId:'task-session',questionId:'a'}]};
  expect(questionOutsideNativeActivity(question,'thread',coverage)).toBeNull();
  for(const altered of [{...coverage,threadId:'other'},{...coverage,questions:[{...coverage.questions[0],questionId:'b'}]},{...coverage,questions:[{...coverage.questions[0],taskSessionId:'old'}]},{...coverage,questions:[]}])expect(questionOutsideNativeActivity(question,'thread',altered)).toBe(question);
  expect(questionOutsideNativeActivity(question,'thread',{...coverage,forbiddenScopes:[{taskId:'native-task',taskSessionId:'task-session'}],questions:[]})).toBeNull();
  const deniedOtherTask={...coverage,questions:[],forbiddenScopes:[{taskId:'other-task',taskSessionId:'other-session'}]};
  expect(questionOutsideNativeActivity(question,'thread',deniedOtherTask)).toBe(question);
  const ordinary={...question,owner:undefined};expect(questionOutsideNativeActivity(ordinary,'thread',{...coverage,forbiddenScopes:[{taskId:'native-task',taskSessionId:'task-session'}]})).toBe(ordinary);
});
it('does not automatically retry an uncertain answer and clears old questions on conversation change',async()=>{
  api.answer.mockRejectedValue(Error('answer_ack_unknown'));const{rerender}=mount();await screen.findByText(form('a').prompt);
  fireEvent.click(within(screen.getByTestId('native-question-'+form('a').questionRef)).getByRole('button',{name:/允许一次|Allow once/}));await screen.findByRole('alert');
  await act(async()=>{changed();});expect(api.answer).toHaveBeenCalledOnce();
  api.list.mockResolvedValue([]);rerender(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="different"/></LocaleProvider></MemoryRouter>);await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());expect(api.answer).toHaveBeenCalledOnce();
});
it('invalidates an earlier held inventory when an answer loses source access',async()=>{
  mount();await screen.findByText(form('a').prompt);let release!:(value:unknown)=>void;
  api.forms.mockImplementationOnce(()=>new Promise(resolve=>{release=resolve;}));await act(async()=>{changed();});await waitFor(()=>expect(release).toBeTypeOf('function'));
  api.answer.mockRejectedValue(Error('activity_source_forbidden'));fireEvent.click(within(screen.getByTestId('native-question-'+form('a').questionRef)).getByRole('button',{name:/允许一次|Allow once/}));
  await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());
  await act(async()=>{release([form('a'),form('b')]);});expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument();expect(api.answer).toHaveBeenCalledOnce();
});
it('does not revive an ACKed question through the old ChatShell form when the following read fails',async()=>{
  const coverage=vi.fn();render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" onNativeCoverage={coverage}/></LocaleProvider></MemoryRouter>);await screen.findByText(form('a').prompt);
  api.work.mockRejectedValue(Error('activity_owner_unavailable'));
  fireEvent.click(within(screen.getByTestId('native-question-'+form('a').questionRef)).getByRole('button',{name:/允许一次|Allow once/}));
  await waitFor(()=>expect(api.work).toHaveBeenCalledTimes(2));await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());
  expect(coverage.mock.lastCall?.[0].questions).toContainEqual({taskId:'native-task',taskSessionId:'task-session',questionId:'a'});expect(api.answer).toHaveBeenCalledOnce();
});
it('retains a late Native denial when another source in the same batch failed first',async()=>{
  const coverage=vi.fn();render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" onNativeCoverage={coverage}/></LocaleProvider></MemoryRouter>);await screen.findByText(form('a').prompt);
  let rejectNative!:(error:Error)=>void;api.list.mockResolvedValue([{watchId:'watch',localSeq:1},{watchId:'mcp',localSeq:2}]);
  api.work.mockImplementation((id:string)=>id==='watch'?new Promise((_resolve,reject)=>{rejectNative=reject;}):Promise.reject(Error('mcp_network_failed')));
  await act(async()=>{changed();});await waitFor(()=>expect(rejectNative).toBeTypeOf('function'));
  await act(async()=>{rejectNative(Error('activity_source_forbidden'));});
  await waitFor(()=>expect(coverage.mock.lastCall?.[0].forbiddenScopes).toContainEqual({taskId:'native-task',taskSessionId:'task-session'}));
});
it('keeps known Native scopes denied after a thread-level list rejection and a subsequent unknown read failure',async()=>{
  const coverage=vi.fn();render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" onNativeCoverage={coverage}/></LocaleProvider></MemoryRouter>);await screen.findByText(form('a').prompt);
  api.list.mockRejectedValue(Error('activity_thread_deleted'));await act(async()=>{changed();});await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());
  expect(coverage.mock.lastCall?.[0].forbiddenScopes).toContainEqual({taskId:'native-task',taskSessionId:'task-session'});
  api.list.mockRejectedValue(Error('activity_owner_unavailable'));await act(async()=>{changed();});await waitFor(()=>expect(api.list).toHaveBeenCalledTimes(3));
  expect(coverage.mock.lastCall?.[0].forbiddenScopes).toContainEqual({taskId:'native-task',taskSessionId:'task-session'});
});
it('clears a known denied Native source immediately while an unrelated work read remains held',async()=>{
  const coverage=vi.fn();render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" onNativeCoverage={coverage}/></LocaleProvider></MemoryRouter>);await screen.findByText(form('a').prompt);
  let release!:(value:unknown)=>void;api.list.mockResolvedValue([{watchId:'watch',localSeq:1},{watchId:'other',localSeq:2}]);api.work.mockImplementation((id:string)=>id==='watch'?Promise.reject(Error('activity_source_forbidden')):new Promise(resolve=>{release=resolve;}));
  await act(async()=>{changed();});await waitFor(()=>expect(release).toBeTypeOf('function'));
  try{await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());expect(coverage.mock.lastCall?.[0].forbiddenScopes).toContainEqual({taskId:'native-task',taskSessionId:'task-session'});}
  finally{await act(async()=>{release({...view('other'),questionSourceKind:undefined});});}
});
it('gives one denied alias priority over an earlier allowed result for the same physical Native task',async()=>{
  const coverage=vi.fn();api.list.mockResolvedValue([{watchId:'watch',localSeq:1},{watchId:'alias',localSeq:2}]);
  render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" onNativeCoverage={coverage}/></LocaleProvider></MemoryRouter>);await screen.findByText(form('a').prompt);
  api.forms.mockImplementation((id:string)=>id==='watch'?Promise.reject(Error('activity_source_forbidden')):Promise.resolve([form('a'),form('b')]));
  await act(async()=>{changed();});await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());
  expect(coverage.mock.lastCall?.[0].forbiddenScopes).toContainEqual({taskId:'native-task',taskSessionId:'task-session'});expect(coverage.mock.lastCall?.[0].questions).toEqual([]);
});
it('keeps Native fallback available when only an unrelated MCP source is forbidden',async()=>{
  const coverage=vi.fn();api.list.mockResolvedValue([{watchId:'watch',localSeq:1},{watchId:'mcp',localSeq:2}]);api.forms.mockRejectedValue(Error('activity_native_source_unsupported'));
  api.work.mockImplementation(async(id:string)=>id==='watch'?view():{...view('mcp'),questionSourceKind:undefined,watch:{...view('mcp').watch,source:'mcp',workId:'mcp-task'},projection:{...view('mcp').projection,errorCode:'activity_source_forbidden'}});
  render(<MemoryRouter><LocaleProvider><ConversationActivityPanel threadId="thread" onNativeCoverage={coverage}/></LocaleProvider></MemoryRouter>);
  await waitFor(()=>expect(api.forms).toHaveBeenCalled());await waitFor(()=>expect(coverage).toHaveBeenLastCalledWith({threadId:'thread',forbiddenScopes:[],questions:[]}));
});
it('clears every alias of the same Native source when its explicit answer is forbidden',async()=>{
  api.list.mockResolvedValue([{watchId:'watch',localSeq:1},{watchId:'alias',localSeq:2}]);api.answer.mockRejectedValue(Error('activity_source_forbidden'));
  mount();await screen.findByText(form('a').prompt);fireEvent.click(within(screen.getByTestId('native-question-'+form('a').questionRef)).getByRole('button',{name:/允许一次|Allow once/}));
  await waitFor(()=>expect(screen.queryByText(form('a').prompt)).not.toBeInTheDocument());expect(screen.queryByText(form('b').prompt)).not.toBeInTheDocument();expect(api.answer).toHaveBeenCalledOnce();
});
