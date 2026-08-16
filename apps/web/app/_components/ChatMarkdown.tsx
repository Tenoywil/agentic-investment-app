'use client';

import Link from 'next/link';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Agent replies, rendered as what they are: markdown.
 *
 * The agent answers comparison questions with GFM tables and emphasis, and the
 * chat used to print that syntax raw — an investor asking "what's best for me"
 * got a paragraph of pipes and dashes (the exact screenshot that prompted
 * this). react-markdown renders to React elements, so nothing goes through
 * dangerouslySetInnerHTML; raw HTML in a reply stays inert text by default.
 * The one legacy habit — `<b>` tags some replies carry — is folded into
 * markdown emphasis before parsing rather than extending the HTML surface.
 *
 * Tables scroll sideways inside their own box: a four-column table cannot fit
 * a 390px bubble, and the alternative — the page scrolling sideways — is the
 * defect the marketplace just fixed.
 */
export function ChatMarkdown({ text }: { text: string }) {
  const source = text.replaceAll('<b>', '**').replaceAll('</b>', '**');
  return (
    <div className="chat-md min-w-0">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto rounded-lg border border-solid border-border">
              <table className="w-full border-collapse text-[13px]">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead>{children}</thead>,
          th: ({ children }) => (
            <th className="border-0 border-b border-solid border-border bg-muted/60 px-2.5 py-1.5 text-left text-[11px] font-bold uppercase tracking-[.4px] text-dim">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-0 border-b border-solid border-border/60 px-2.5 py-1.5 align-top [tr:last-child>&]:border-b-0">
              {children}
            </td>
          ),
          p: ({ children }) => <p className="my-1.5 first:mt-0 last:mb-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="my-1.5 flex list-disc flex-col gap-1 pl-5 first:mt-0 last:mb-0">
              {children}
            </ul>
          ),
          ol: ({ children }) => (
            <ol className="my-1.5 flex list-decimal flex-col gap-1 pl-5 first:mt-0 last:mb-0">
              {children}
            </ol>
          ),
          li: ({ children }) => <li className="[&>p]:my-0">{children}</li>,
          // An in-app path navigates in this tab — the agent pointing you at
          // your own marketplace must not open a second copy of the app. Only
          // genuinely external links get a new tab.
          a: ({ href, children }) => {
            const h = href ?? '';
            const cls = 'font-semibold text-teal2 underline underline-offset-2';
            return h.startsWith('/') ? (
              <Link href={h} className={cls}>
                {children}
              </Link>
            ) : (
              <a href={h} target="_blank" rel="noreferrer" className={cls}>
                {children}
              </a>
            );
          },
          code: ({ children }) => (
            <code className="rounded bg-muted/70 px-1 py-0.5 font-mono text-[12.5px]">
              {children}
            </code>
          ),
          // A heading inside a chat bubble is emphasis, not document structure —
          // h1..h6 would fight the page's own outline.
          h1: ({ children }) => <p className="my-1.5 font-bold first:mt-0 last:mb-0">{children}</p>,
          h2: ({ children }) => <p className="my-1.5 font-bold first:mt-0 last:mb-0">{children}</p>,
          h3: ({ children }) => <p className="my-1.5 font-bold first:mt-0 last:mb-0">{children}</p>,
          hr: () => <div className="my-2 border-0 border-t border-solid border-border" />,
        }}
      >
        {source}
      </Markdown>
    </div>
  );
}
