import { describe, expect, it } from 'bun:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  PRODUCT_CSV_TEMPLATE,
  auditActionLabel,
  auditEntityLabel,
  consoleTab,
  parseProductImport,
  refreshCurrentLoaders,
} from '../app/_components/console/lib';

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

describe('product spreadsheet import', () => {
  it('parses the template into the single-product API contract', () => {
    const result = parseProductImport(PRODUCT_CSV_TEMPLATE);
    expect(result.errors).toEqual([]);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({
      name: 'Sample Caribbean Income Fund',
      type: 'fund',
      currency: 'USD',
      minInvestmentMinor: '500000',
      risk: 'medium',
      description: 'Replace this sample row with your product description',
    });
  });

  it('accepts tab-separated spreadsheet rows and useful header aliases', () => {
    const result = parseProductImport(
      'product name\tasset type\tcurrency\tminimum\trisk rating\nRegional Note\treal estate\tJMD\t1,250.50\thigh',
    );
    expect(result.errors).toEqual([]);
    expect(result.products[0]).toMatchObject({
      name: 'Regional Note',
      type: 'real_estate',
      currency: 'JMD',
      minInvestmentMinor: '125050',
      risk: 'high',
    });
  });

  it('rejects unknown columns, incomplete headline data and oversized batches', () => {
    expect(parseProductImport('name,type,risk,secret\nFund,fund,low,value').errors).toContain(
      'Unknown column “secret”.',
    );
    expect(parseProductImport('name,type,risk,metric\nFund,fund,low,7%').errors[0]).toContain(
      'metric and metric_label',
    );
    const rows = Array.from({ length: 101 }, (_, index) => `Fund ${index},fund,low`).join('\n');
    expect(parseProductImport(`name,type,risk\n${rows}`).errors[0]).toContain('at most 100');
    expect(
      parseProductImport(`name,type,risk,minimum\nFund,fund,low,${'9'.repeat(100_000)}`).errors[0],
    ).toContain('exceeds the supported amount range');
  });
});

describe('isolated partner demo', () => {
  const source = readFileSync(join(REPO, 'apps/web/app/demo/institutions/page.tsx'), 'utf8');

  it('shares the live console surfaces without importing a live client', () => {
    expect(source).toContain('<OverviewTab');
    expect(source).toContain('<OrdersTab');
    expect(source).toContain('<ProductsTab');
    expect(source).toContain('<ListProductDialog');
    expect(source).toContain('<BulkProductDialog');
    expect(source).toMatch(/import type \{[^}]+\} from '@\/lib\/console-api';/s);
    expect(source).not.toMatch(/import \{[^}]+\} from '@\/lib\/console-api';/s);
    expect(source).not.toContain('fetch(');
    expect(source).not.toContain('authClient');
  });

  it('uses bottom navigation and keeps the redundant hamburger out', () => {
    expect(source).toContain('<ConsoleMobileTabs');
    expect(source).not.toContain('Menu');
    expect(source).not.toContain('showModal()');
  });

  it('rehearses real paging without gaining access to live data', () => {
    expect(source).toContain('const [orderOffset, setOrderOffset]');
    expect(source).toContain('const [productOffset, setProductOffset]');
    expect(source).toContain('<ConsolePager');
    expect(source).not.toContain('onPage={() => undefined}');
  });
});

describe('bounded partner console queues', () => {
  const live = readFileSync(join(REPO, 'apps/web/app/(institution)/institutions/page.tsx'), 'utf8');
  const components = [
    'orders-tab.tsx',
    'products-tab.tsx',
    'client-review.tsx',
    'clients-tab.tsx',
    'compliance-tab.tsx',
  ].map((file) => readFileSync(join(REPO, 'apps/web/app/_components/console', file), 'utf8'));

  it('uses one pager across every growing operational list', () => {
    for (const source of components) expect(source).toContain('<ConsolePager');
    expect(live).toContain('const CONSOLE_PAGE_SIZE = 10');
    expect(live).not.toContain('const ORDER_PAGE = 50');
    expect(live).not.toContain('getAudit(50)');
  });

  it('keeps workload badges independent of the filtered page', () => {
    expect(live).toContain('pendingOrders={summary?.createdOrders ?? 0}');
    expect(live).toContain('pendingClientTotal={summary?.pendingClients ?? 0}');
    expect(live).toContain('pendingWithdrawalTotal={summary?.pendingWithdrawals ?? 0}');
    expect(live).toContain('orders={overviewOrders}');
  });

  it('starts each section at the top instead of preserving another queue’s scroll depth', () => {
    const demo = readFileSync(join(REPO, 'apps/web/app/demo/institutions/page.tsx'), 'utf8');
    expect(live).toContain("window.scrollTo({ top: 0, behavior: 'auto' })");
    expect(demo).toContain("window.scrollTo({ top: 0, behavior: 'auto' })");
  });

  it('resolves post-mutation refreshes from the latest filter and page render', async () => {
    const calls: string[] = [];
    let releaseMutation: (() => void) | undefined;
    const mutation = new Promise<void>((resolve) => {
      releaseMutation = resolve;
    });
    const loaders = {
      current: {
        orders: async () => {
          calls.push('captured');
        },
      },
    };

    const afterMutation = mutation.then(() =>
      refreshCurrentLoaders(loaders, ['orders'] as const, false),
    );
    loaders.current = {
      orders: async () => {
        calls.push('latest');
      },
    };
    releaseMutation?.();
    await afterMutation;

    expect(calls).toEqual(['latest']);
    expect(live).toContain('refreshCurrentLoaders(currentLoaders');
    expect(live).not.toMatch(
      /\bload(?:Orders|Products|Clients|Reconciliation|Withdrawals|Audit|Reference)\(false\)/,
    );
  });
});
