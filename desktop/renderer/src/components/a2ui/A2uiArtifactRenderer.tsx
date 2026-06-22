import React, { Component, useMemo, type ErrorInfo, type ReactNode } from 'react';
import type { ArtifactRef } from '../../storage';
import { validateA2uiMessages, type A2UIMessage } from '../../../../../src/a2ui/index.js';
import { A2uiSurfaceRenderer } from './A2uiSurfaceRenderer';
import { useLocale } from '../../contexts/LocaleContext';

type Props = {
  artifactContent: string;
  artifactRef: ArtifactRef;
};

type ErrorBoundaryState = {
  error: string | null;
};

class A2uiErrorBoundary extends Component<{ resetKey: string; errorMessage: string; children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  componentDidUpdate(prevProps: { resetKey: string }) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.setState({ error: error.message });
  }

  render() {
    if (this.state.error) return <A2uiRenderError message={this.props.errorMessage} />;
    return this.props.children;
  }
}

export function A2uiArtifactRenderer({ artifactContent, artifactRef }: Props) {
  const { t } = useLocale();
  const parsed = useMemo(() => {
    try {
      const messages = JSON.parse(artifactContent);
      const validation = validateA2uiMessages(messages);
      if (!validation.ok) return { ok: false as const };
      return { ok: true as const, messages: messages as A2UIMessage[] };
    } catch {
      return { ok: false as const };
    }
  }, [artifactContent, artifactRef.key, artifactRef.artifactId]);

  if (!parsed.ok) return <A2uiRenderError message={t.a2uiRenderError} />;

  const resetKey = `${artifactRef.key ?? artifactRef.artifactId}:${artifactContent.length}`;
  return (
    <A2uiErrorBoundary resetKey={resetKey} errorMessage={t.a2uiRenderError}>
      <A2uiSurfaceRenderer messages={parsed.messages} />
    </A2uiErrorBoundary>
  );
}

function A2uiRenderError({ message }: { message?: string }) {
  const { t } = useLocale();
  return (
    <div
      role="alert"
      style={{
        maxWidth: 720,
        border: '1px solid var(--c-status-error-border, var(--c-border))',
        borderRadius: 8,
        background: 'var(--c-status-error-bg, var(--c-bg-card))',
        color: 'var(--c-status-error-text, var(--c-text-secondary))',
        padding: '10px 12px',
        fontSize: 13,
      }}
    >
      {message || t.a2uiRenderError}
    </div>
  );
}
