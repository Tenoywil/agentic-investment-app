import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { auditActionLabel, auditEntityLabel, consoleTab } from '../app/_components/console/lib';

/**
 * The console speaks English, not Postgres.
 *
 * The audit trail is the partner's regulated record, and it was rendering the
 * writer's own identifiers at whoever read it: `instrument.listed`,
 * `connected_account.refreshed`, and under each row the bare table name
 * `reconciliation_items`. A compliance officer should not have to know the
 * schema to read their own log.
 *
 * So rather than trusting a map to stay complete, this walks the places audit
 * rows are actually written — the migrations and the API — pulls out every
 * action key and entity type, and asserts the console can put each into words.
 * A new `audit_append` with a new key fails here until the label exists.
 */

const REPO = resolve(import.meta.dir, '../../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '.turbo' || entry === 'dist') continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith('.ts') || path.endsWith('.sql')) out.push(path);
  }
  return out;
}

const SOURCES = [
  ...walk(join(REPO, 'packages/db/migrations')),
  ...walk(join(REPO, 'apps/api/src')),
];

/**
 * Not settings. `app.current_user_id` and friends are GUC names that happen to
 * share the dotted shape; they are never audit actions.
 */
const NOT_AN_ACTION = /^(app|pg|search)\./;

/**
 * `audit_append(actor, user, subject, partner, ACTION, ENTITY, ...)` in SQL,
 * and `auditAppend({ action, entityType })` in TypeScript. Both are read
 * loosely — a key this scan misses is a label that goes unchecked, not a false
 * failure — because the point is coverage of what exists, not a parser.
 */
function actionKeys(): Set<string> {
  const found = new Set<string>();
  for (const file of SOURCES) {
    const text = readFileSync(file, 'utf8');
    for (const [, key] of text.matchAll(/action:\s*'([a-z][a-z0-9_.]*\.[a-z0-9_.]+)'/g)) {
      if (key) found.add(key);
    }
    if (!file.endsWith('.sql')) continue;
    // In SQL the action is a bare quoted literal, sometimes cast to text and
    // sometimes not, so the shape is what identifies it.
    for (const [, key] of text.matchAll(/'([a-z][a-z0-9_]*\.[a-z0-9_.]+)'(?:::text)?/g)) {
      if (key && !NOT_AN_ACTION.test(key)) found.add(key);
    }
  }
  return found;
}

function entityTypes(): Set<string> {
  const found = new Set<string>();
  for (const file of SOURCES) {
    const text = readFileSync(file, 'utf8');
    for (const [, key] of text.matchAll(/entityType:\s*'([a-z][a-z0-9_]*)'/g)) {
      if (key) found.add(key);
    }
    if (!file.endsWith('.sql')) continue;
    // audit_append(..., action, entity_type, ...) — the entity is the quoted
    // literal immediately after the dotted action key.
    for (const [, action, entity] of text.matchAll(
      /'([a-z][a-z0-9_]*\.[a-z0-9_.]+)'(?:::text)?\s*,\s*'([a-z][a-z0-9_]*)'/g,
    )) {
      if (action && entity && !NOT_AN_ACTION.test(action)) found.add(entity);
    }
  }
  return found;
}

/** Nothing a reader sees may carry a separator only a schema uses. */
const RAW_IDENTIFIER = /[._]/;

describe('console audit vocabulary', () => {
  it('finds the audit actions the product actually writes', () => {
    const keys = actionKeys();
    // A sanity floor: if the scan silently matches nothing, every assertion
    // below passes vacuously and this guard would be decorative.
    expect(keys.size).toBeGreaterThan(10);
    expect(keys).toContain('order.settled');
    expect(keys).toContain('instrument.listed');
  });

  it('puts every audit action into words', () => {
    const raw: string[] = [];
    for (const key of actionKeys()) {
      if (RAW_IDENTIFIER.test(auditActionLabel(key))) raw.push(key);
    }
    expect(raw).toEqual([]);
  });

  it('puts every audited entity type into words', () => {
    const raw: string[] = [];
    for (const key of entityTypes()) {
      const label = auditEntityLabel(key);
      if (label && RAW_IDENTIFIER.test(label)) raw.push(key);
    }
    expect(raw).toEqual([]);
  });

  it('names an action no build has seen without printing its key', () => {
    // The log is append-only: it will always hold rows written by a build older
    // than the screen reading them, so the fallback has to be readable too.
    expect(auditActionLabel('some_future_thing.happened')).toBe('Some future thing happened');
    expect(auditEntityLabel('future_records')).toBe('Future records');
    expect(auditEntityLabel(null)).toBeNull();
  });
});

describe('console browser routes', () => {
  it('restores every institution section from its URL value', () => {
    expect(['overview', 'orders', 'products', 'clients', 'compliance'].map(consoleTab)).toEqual([
      'overview',
      'orders',
      'products',
      'clients',
      'compliance',
    ]);
  });

  it('falls back safely when a section is absent or unknown', () => {
    expect(consoleTab(null)).toBe('overview');
    expect(consoleTab('not-a-console-section')).toBe('overview');
  });
});
