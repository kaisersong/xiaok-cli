import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { memo } from 'react';

interface MarkdownRendererProps {
  content: string;
}

export const MarkdownRenderer = memo(function MarkdownRenderer({ content }: MarkdownRendererProps) {
  return (
    <div className="prose prose-sm max-w-none">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ inline, className, children, ...props }) {
            if (inline) {
              return (
                <code className="rounded bg-gray-100 px-1.5 py-0.5 text-sm font-mono" {...props}>
                  {children}
                </code>
              );
            }
            return (
              <div className="relative my-3">
                <div className="flex items-center justify-between rounded-t-lg bg-gray-800 px-4 py-2 text-xs text-gray-300">
                  <span>{className?.replace('language-', '') || 'code'}</span>
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(String(children))}
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
            return <p className="text-sm leading-relaxed mb-3">{children}</p>;
          },
          table({ children }) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="min-w-full border border-[var(--c-border)] text-sm">
                  {children}
                </table>
              </div>
            );
          },
          th({ children }) {
            return (
              <th className="border border-[var(--c-border)] bg-gray-50 px-3 py-2 text-left font-medium">
                {children}
              </th>
            );
          },
          td({ children }) {
            return (
              <td className="border border-[var(--c-border)] px-3 py-2">{children}</td>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
