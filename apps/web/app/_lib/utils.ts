import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Merge Tailwind class lists, resolving conflicts (shadcn's `cn`). */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Split an approval title of the form "Instrument name · US$2,010" into its
 * halves, on the FINAL " · " so an instrument whose own name contains the
 * separator keeps it. Null when the title carries no separator — the caller
 * renders the title as-is rather than inventing an amount line.
 */
export function splitApprovalTitle(title: string): { name: string; amount: string } | null {
  const at = title.lastIndexOf(' · ');
  if (at === -1) return null;
  const name = title.slice(0, at).trim();
  const amount = title.slice(at + 3).trim();
  if (!name || !amount) return null;
  return { name, amount };
}

/**
 * An agent reply reduced to one plain sentence for a feed row.
 *
 * The home screen's activity feed shows the agent's recent messages in a
 * two-line clamp, and the agent answers comparison questions in GFM markdown —
 * so the feed used to open with a wall of pipes and dashes (the raw table)
 * where a person expected a sentence. A feed row is a summary, not a document:
 * table and separator lines are dropped entirely, emphasis/heading/link syntax
 * is unwrapped, and what remains is the reply's own prose.
 */
export function agentFeedPreview(markdown: string): string {
  const prose = markdown
    .replaceAll('<b>', '')
    .replaceAll('</b>', '')
    .split('\n')
    .map((line) => line.trim())
    // A table row, a |---| rule, a --- rule, or a list bullet's bare dash all
    // read as noise in a one-line preview.
    .filter((line) => line.length > 0 && !line.startsWith('|') && !/^[-=*_\s|:]+$/.test(line))
    .map(
      (line) =>
        line
          .replace(/^#{1,6}\s+/, '') // headings
          .replace(/^[-*+]\s+/, '') // list bullets
          .replace(/^\d+\.\s+/, '') // ordered list markers
          .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
          .replace(/\*([^*]+)\*/g, '$1') // italics
          .replace(/`([^`]+)`/g, '$1') // inline code
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1'), // links -> their text
    )
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  // A reply that was only a table still deserves an honest row.
  return prose || 'Shared a breakdown with you — open the agent to see it.';
}
