import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo, type ReactNode, Children } from 'react';
import { MermaidBlock } from './MermaidBlock';

const FILE_PATH_RE = /(\/(?:Users|home|tmp|var|etc|opt|mnt|srv)\/[\w./ -]+|[A-Z]:\\[\w.\\ -]+)/g;

function linkifyFilePaths(children: ReactNode): ReactNode {
  return Children.map(children, child => {
    if (typeof child !== 'string') return child;
    const parts = child.split(FILE_PATH_RE);
    if (parts.length === 1) return child;
    return parts.map((part, i) => {
      if (i % 2 === 1) {
        return (
          <span
            key={i}
            role="link"
            tabIndex={0}
            className="text-[var(--c-accent)] hover:underline cursor-pointer font-mono text-xs"
            onClick={() => {
              const api = (window as any).xiaokDesktop;
              if (api?.openPath) api.openPath(part);
              else if (api?.showItemInFolder) api.showItemInFolder(part);
              else window.open(`file://${part}`, '_blank');
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const api = (window as any).xiaokDesktop;
                if (api?.openPath) api.openPath(part);
                else if (api?.showItemInFolder) api.showItemInFolder(part);
                else window.open(`file://${part}`, '_blank');
              }
            }}
          >
            {part}
          </span>
        );
      }
      return part;
    });
  });
}

interface MarkdownRendererProps {
  content: string;
  streaming?: boolean;
}

function stripUnclosedMermaid(text: string): string {
  let out = text;
  let searchFrom = 0;
  while (true) {
    const openIdx = out.indexOf('```mermaid', searchFrom);
    if (openIdx < 0) break;
    const afterOpen = openIdx + '```mermaid'.length;
    const closeIdx = out.indexOf('```', afterOpen);
    if (closeIdx < 0) {
      out = out.slice(0, openIdx).replace(/\n+$/, '');
      break;
    }
    searchFrom = closeIdx + 3;
  }
  return out;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content, streaming }: MarkdownRendererProps) {
  const displayContent = streaming ? stripUnclosedMermaid(content) : content;

  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const lang = className?.replace('language-', '') || '';
            const text = String(children).replace(/\n$/, '');
            const isBlock = text.includes('\n') || lang.length > 0;
            if (!isBlock) {
              return (
                <code className="rounded bg-[var(--c-bg-deep)] px-1.5 py-0.5 text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }
            if (lang === 'mermaid') {
              return <MermaidBlock content={text} />;
            }
            return (
              <div className="relative my-3">
                <div className="flex items-center justify-between rounded-t-lg bg-gray-800 px-4 py-2 text-xs text-gray-300">
                  <span>{lang || 'code'}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(text)}
                    className="hover:text-white"
                  >
                    Copy
                  </button>
                </div>
                <pre className="rounded-b-lg bg-gray-900 p-4 text-sm text-gray-100 overflow-x-auto">
                  <code {...props}>{children}</code>
                </pre>
              </div>
            );
          },
          a({ href, children }) {
            return (
              <a href={href} className="text-[var(--c-accent)] hover:underline" target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-4 border-[var(--c-border)] pl-4 italic text-[var(--c-text-secondary)]">
                {children}
              </blockquote>
            );
          },
          ul({ children }) {
            return <ul className="list-disc pl-5 space-y-1">{children}</ul>;
          },
          ol({ children }) {
            return <ol className="list-decimal pl-5 space-y-1">{children}</ol>;
          },
          li({ children }) {
            return <li className="text-sm">{children}</li>;
          },
          h1({ children }) {
            return <h1 className="text-2xl font-semibold mt-6 mb-3">{children}</h1>;
          },
          h2({ children }) {
            return <h2 className="text-xl font-semibold mt-5 mb-2">{children}</h2>;
          },
          h3({ children }) {
            return <h3 className="text-lg font-semibold mt-4 mb-2">{children}</h3>;
          },
          p({ children }) {
            return <p className="text-sm leading-relaxed mb-3">{linkifyFilePaths(children)}</p>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="min-w-full border-collapse border border-[var(--c-border)] text-sm not-prose" style={{ width: '100%' }}>
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-[var(--c-border)] bg-[var(--c-bg-deep)] px-3 py-2 text-left font-medium" style={{ borderBottomWidth: '2px' }}>
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-[var(--c-border)] px-3 py-2">{children}</td>
            );
          },
          hr() {
            return (
              <hr className="my-6 border-[var(--c-border)]" />
            );
          },
        }}
      >
        {displayContent}
      </ReactMarkdown>
    </div>
  );
});
