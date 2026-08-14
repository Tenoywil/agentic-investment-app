'use client';

/**
 * Taking a list off the console.
 *
 * A regulated desk reconciles against its own systems and answers questions from
 * a regulator, and neither is done by reading a web page. The console had no way
 * to get anything out of it at all.
 *
 * Generated in the browser from rows already fetched, rather than as a new API
 * route: the reads are now filtered and paginated, so "export" means "the rows
 * matching what is on screen", and asking the server for them a second time
 * would be a second, differently-filtered answer to the same question. The
 * caller passes a larger page for the export and is told when that truncated.
 */

/**
 * RFC 4180 quoting.
 *
 * Everything is quoted rather than only the fields that need it. A partner name
 * with a comma, a decline reason with a newline, and a client reference starting
 * with `=` are all real values here, and the third is why this matters beyond
 * tidiness: a bare `=`, `+`, `-` or `@` at the start of a cell is executed as a
 * formula by Excel and Sheets. Prefixing with an apostrophe defuses it without
 * changing what a human reads.
 */
function cell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  const raw = String(value);
  const defused = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${defused.replace(/"/g, '""')}"`;
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const head = columns.map((c) => cell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => cell(c.value(r))).join(','));
  // CRLF, which is what RFC 4180 specifies and what Excel expects.
  return [head, ...body].join('\r\n');
}

/**
 * Hand the file to the browser.
 *
 * An object URL rather than a data: URI — a desk's full order history is larger
 * than the length limit some browsers put on the latter — and it is revoked
 * afterwards so the blob is not held for the life of the tab.
 */
export function downloadCsv(filename: string, csv: string): void {
  // The BOM is what makes Excel read this as UTF-8 rather than the local
  // codepage, which is the difference between a partner's name and mojibake.
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** `orders-2026-08-14.csv` — dated, because a desk keeps more than one. */
export function datedFilename(stem: string): string {
  return `${stem}-${new Date().toISOString().slice(0, 10)}.csv`;
}
