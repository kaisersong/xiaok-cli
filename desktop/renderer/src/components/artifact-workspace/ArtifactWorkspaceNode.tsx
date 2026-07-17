import type { KeyboardEvent } from 'react';
import type { Node, NodeProps } from '@xyflow/react';
import type { ArtifactWorkspaceNode as WorkspaceNode } from '../../../../shared/artifact-workspace-types';
import { useLocale } from '../../contexts/LocaleContext';

export interface ArtifactWorkspaceNodeData extends Record<string, unknown> {
  node: WorkspaceNode;
  label: string;
  tabIndex: number;
  onFocus: (nodeId: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>, node: WorkspaceNode) => void;
  onOpen: (node: WorkspaceNode) => void;
}

export type ArtifactWorkspaceFlowNode = Node<ArtifactWorkspaceNodeData, WorkspaceNode['kind']>;

export function ArtifactWorkspaceNode({ data, selected }: NodeProps<ArtifactWorkspaceFlowNode>) {
  const { t } = useLocale();
  const state = data.node.kind === 'placeholder' ? data.node.placeholderState : undefined;
  return (
    <article
      className={`artifact-workspace-node artifact-workspace-node-${data.node.kind}${selected ? ' is-selected' : ''}`}
      data-node-kind={data.node.kind}
    >
      <button
        type="button"
        tabIndex={data.tabIndex}
        aria-label={data.label}
        onFocus={() => data.onFocus(data.node.id)}
        onDoubleClick={() => data.onOpen(data.node)}
        onKeyDown={(event) => data.onKeyDown(event, data.node)}
      >
        <span className="artifact-workspace-node-kind">{data.node.kind}</span>
        <strong>{data.label}</strong>
        {state ? <small>{t.artifactWorkspace.statusLabel(state)}</small> : null}
      </button>
    </article>
  );
}
