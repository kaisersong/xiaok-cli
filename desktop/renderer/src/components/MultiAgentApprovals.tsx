import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DesktopAgentSnapshot, MultiAgentApprovalView, MultiAgentDesktopAPI, MultiAgentPendingApproval } from '../../../shared/multi-agent-types';
import { useLocale } from '../contexts/LocaleContext';
import type { MultiAgentConnection } from '../lib/multi-agent-connection';
import { approvalIdentityKey, decodeApprovalPage, type ApprovalIdentity } from '../lib/multi-agent-approval-reader';
import { UserDecisionCard } from './UserDecisionCard';

interface Scope { api: MultiAgentDesktopAPI; connection: MultiAgentConnection; threadId: string; groupId: string; bootId: string }
interface Props extends Scope { pending: MultiAgentPendingApproval[]; agents: DesktopAgentSnapshot[]; readonly: boolean; now: number }
export function MultiAgentApprovals(props: Props) {
  const scope = useMemo<Scope>(() => ({ api: props.api, connection: props.connection, threadId: props.threadId, groupId: props.groupId, bootId: props.bootId }),
    [props.api, props.connection, props.threadId, props.groupId, props.bootId]);
  return <div className="space-y-3">{props.pending.slice(0, 9).map(pending => <ApprovalCard key={pending.approvalId}
    scope={scope} pending={pending} agent={props.agents.find(agent => agent.id === pending.agentId)} readonly={props.readonly} now={props.now} />)}</div>;
}
function ApprovalCard({ scope, pending, agent, readonly, now }: { scope: Scope; pending: MultiAgentPendingApproval; agent?: DesktopAgentSnapshot; readonly: boolean; now: number }) {
  const { t } = useLocale(), labels = t.multiAgent.approvals;
  const key = approvalIdentityKey({ ...scope, pending });
  const owner = useMemo(() => ({ scope, identity: { threadId: scope.threadId, groupId: scope.groupId, bootId: scope.bootId, pending } satisfies ApprovalIdentity, readonly }), [scope, key, readonly]);
  const latest = useRef<typeof owner | null>(owner);
  const [metadata, setMetadata] = useState<{ owner: typeof owner; value?: MultiAgentApprovalView; error?: boolean }>();
  const [operation, setOperation] = useState<{ owner: typeof owner; operationId: string; phase: 'busy' | 'unknown' | 'received' }>();
  const [input, setInput] = useState<{ owner: typeof owner; phase: 'reading' | 'ready' | 'error'; text?: string; startOffset: number; nextOffset: number }>();
  const bytes = useRef<Uint8Array[]>([]), decoder = useRef<TextDecoder | null>(null);
  const readPending = useRef(false), decidePending = useRef(false);
  useLayoutEffect(() => {
    latest.current = owner; bytes.current = []; decoder.current = null; readPending.current = false; decidePending.current = false;
    return () => { latest.current = null; bytes.current = []; decoder.current = null; };
  }, [owner]);
  useEffect(() => {
    let cancelled = false;
    void scope.connection.getApprovalMetadata(pending).then(value => {
      if (!cancelled && latest.current === owner) setMetadata({ owner, value });
    }, () => { if (!cancelled && latest.current === owner) setMetadata({ owner, error: true }); });
    return () => { cancelled = true; };
  }, [owner]);
  const retryMetadata = async () => {
    if (latest.current !== owner) return;
    setMetadata({ owner });
    try {
      const value = await scope.connection.getApprovalMetadata(pending, true);
      if (latest.current === owner) setMetadata({ owner, value });
    } catch { if (latest.current === owner) setMetadata({ owner, error: true }); }
  };
  const value = metadata?.owner === owner ? metadata.value : undefined;
  const receipt = operation?.owner === owner ? operation : scope.connection.getApprovalReceipt(owner.identity);
  const savedInput = input?.owner === owner ? input : undefined;
  const seconds = Math.max(0, Math.ceil((pending.minDeadlineAt - now) / 1000));
  const canUse = () => latest.current === owner && !owner.readonly && scope.connection.isApprovalCurrent(owner.identity)
    && Date.now() < pending.minDeadlineAt && value?.status === 'pending' && value.persistenceState === 'confirmed' && value.canDecide;
  const allowed = !readonly && seconds > 0 && !!value && scope.connection.isApprovalCurrent(owner.identity)
    && value.canDecide && value.persistenceState === 'confirmed' && value.status === 'pending';
  const decide = async (decision: 'approve' | 'deny') => {
    if (!canUse() || receipt || decidePending.current) return;
    const operationId = crypto.randomUUID(); decidePending.current = true; setOperation({ owner, operationId, phase: 'busy' });
    scope.connection.rememberApprovalReceipt(owner.identity, { operationId, phase: 'unknown' });
    try {
      const result = await scope.api.decideMultiAgentApproval({ threadId: scope.threadId, groupId: scope.groupId, approvalId: pending.approvalId, operationId, decision });
      if (latest.current !== owner) return;
      setOperation({ owner, operationId, phase: result.state === 'unknown' ? 'unknown' : 'received' });
      scope.connection.rememberApprovalReceipt(owner.identity, { operationId, phase: result.state === 'unknown' ? 'unknown' : 'received' });
      scope.connection.refresh();
    } catch { if (latest.current === owner) setOperation({ owner, operationId, phase: 'unknown' }); }
    finally { if (latest.current === owner) decidePending.current = false; }
  };
  const query = async () => {
    if (!receipt || decidePending.current || latest.current !== owner) return;
    decidePending.current = true;
    try {
      const result = await scope.api.getMultiAgentOperation({ threadId: scope.threadId, groupId: scope.groupId, operationId: receipt.operationId });
      if (latest.current !== owner) return;
      if (result?.applyState === 'applied') {
        setOperation({ owner, operationId: receipt.operationId, phase: 'received' });
        scope.connection.rememberApprovalReceipt(owner.identity, { operationId: receipt.operationId, phase: 'received' });
      }
      scope.connection.refresh();
    } catch { /* Read failure never authorizes another decision. */ }
    finally { if (latest.current === owner) decidePending.current = false; }
  };
  const read = async (offset: number) => {
    if (!canUse() || readPending.current) return;
    readPending.current = true;
    if (!offset) { bytes.current = []; decoder.current = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }); }
    setInput({ owner, phase: 'reading', startOffset: offset, nextOffset: offset });
    try {
      const response = await scope.api.getMultiAgentApproval({ threadId: scope.threadId, groupId: scope.groupId, approvalId: pending.approvalId, inputOffset: offset });
      if (!canUse()) return;
      const chunk = decodeApprovalPage(response, owner.identity, offset);
      const nextOffset = offset + chunk.byteLength, complete = nextOffset === pending.inputByteLength;
      bytes.current.push(chunk);
      const text = decoder.current!.decode(chunk, { stream: !complete });
      if (complete) {
        if (!crypto.subtle) throw new Error('approval_digest_unavailable');
        const all = new Uint8Array(nextOffset); let cursor = 0;
        for (const part of bytes.current) { all.set(part, cursor); cursor += part.length; }
        const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', all));
        if (!canUse()) return;
        if ([...digest].map(byte => byte.toString(16).padStart(2, '0')).join('') !== pending.inputSha256) throw new Error('approval_input_digest_mismatch');
        bytes.current = []; decoder.current = null;
      }
      setInput({ owner, phase: 'ready', text, startOffset: offset, nextOffset });
    } catch { if (latest.current === owner) { bytes.current = []; decoder.current = null; setInput({ owner, phase: 'error', startOffset: 0, nextOffset: 0 }); } }
    finally { if (latest.current === owner) readPending.current = false; }
  };
  const name = agent?.parentId === null ? t.multiAgent.mainAgent : agent?.presentationOrdinal ? t.multiAgent.alias(agent.presentationOrdinal) : agent?.taskName ?? pending.agentId;
  const buttons = 'rounded-lg border px-3 py-2 text-sm disabled:opacity-40';
  return <UserDecisionCard label={`${labels.title} ${name}`} prompt={<>{labels.title} · {name}</>} actions={<>
    <button type="button" className={buttons} disabled={!allowed || !!receipt} onClick={() => void decide('approve')}>{labels.approve}</button>
    <button type="button" className={buttons} disabled={!allowed || !!receipt} onClick={() => void decide('deny')}>{labels.deny}</button>
    {receipt?.phase === 'unknown' && <button type="button" className={buttons} onClick={() => void query()}>{labels.query}</button>}
  </>}>
    <div className="space-y-1 break-all text-xs">
      <p><code>{pending.agentId}</code> · {t.multiAgent.turnLabel(pending.turn)}</p><p><code>{pending.turnId}</code></p>
      {value && <><p>{value.toolName}</p><p>{value.cwd}</p></>}
      <p><code>{pending.inputSha256}</code></p><p>{labels.deadline(seconds)}</p>
      <p>{labels.statuses[value?.status ?? pending.status]}</p>
      {metadata?.owner === owner && metadata.error && <><p role="alert">{labels.metadataFailed}</p>
        <button type="button" className={buttons} onClick={() => void retryMetadata()}>{labels.retryMetadata}</button></>}
      {receipt && receipt.phase !== 'busy' && <p role="status">{receipt.phase === 'unknown' ? labels.unknown : labels.received}</p>}
      {allowed && <button type="button" className={buttons} disabled={savedInput?.phase === 'reading'} onClick={() => void read(0)}>{labels.viewInput}</button>}
      {allowed && savedInput?.phase === 'reading' && <p role="status">{labels.inputLoading}</p>}
      {allowed && savedInput?.phase === 'error' && <p role="alert">{labels.inputFailed}</p>}
      {allowed && savedInput?.phase === 'ready' && <>
        <p>{labels.inputProgress(savedInput.startOffset, savedInput.nextOffset, pending.inputByteLength)}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{savedInput.text}</pre>
        {savedInput.nextOffset < pending.inputByteLength && <button type="button" className={buttons} onClick={() => void read(savedInput.nextOffset)}>{labels.nextInput}</button>}
      </>}
    </div>
  </UserDecisionCard>;
}
