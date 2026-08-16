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
