import { useSyncExternalStore } from 'react';
import type { DesktopAgentSnapshot } from '../../../shared/multi-agent-types';
import type { HostDeliveryRecord } from '../../../../src/runtime/task-host/delivery-types';
import type { MultiAgentConnection } from '../lib/multi-agent-connection';
import { useLocale } from '../contexts/LocaleContext';

interface Props {
  status?: HostDeliveryRecord['status']; guardFailure?: HostDeliveryRecord['guardFailure'];
  cleanupPending?: boolean; executionStatus?: DesktopAgentSnapshot['status'];
}
/** Presentation only: delivery never determines the execution or resource state. */
export function HostDeliveryStatus({ status, guardFailure, cleanupPending, executionStatus }: Props) {
  const { t } = useLocale(); const labels = t.multiAgent;
  if (!status) return null;
  return <div className="multi-agent-note" data-testid="host-delivery-status">
    {executionStatus === 'completed' ? <p>{labels.executionCompleted}</p> : null}
    <p>{labels.deliveryStatuses[status]}</p>
    {guardFailure ? <p>{labels.deliveryReasons[guardFailure.code]}</p> : null}
    {cleanupPending ? <p>{labels.deliveryCleanupPending}</p> : null}
    {guardFailure?.needsExplicitFollowup ? <p>{labels.deliveryFollowup}</p> : null}
  </div>;
}

/** Reuses the one existing owner, without subscribing the whole Chat transcript. */
export function TaskDeliveryStatus({ connection, sourceTaskId }: { connection: MultiAgentConnection; sourceTaskId?: string }) {
  const { projection } = useSyncExternalStore(connection.subscribe, connection.getSnapshot);
  const root = projection.root;
  if (!sourceTaskId || projection.threadDeleteState === 'deleted' || root?.sourceTaskId !== sourceTaskId) return null;
  return <HostDeliveryStatus status={root.hostDeliveryStatus} guardFailure={root.guardFailure}
    cleanupPending={root.hostDeliveryCleanupPending} executionStatus={root.status} />;
}
