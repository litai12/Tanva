import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { CreditsService } from '../src/credits/credits.service';

const receipt = (status: string, billingStatus: string, terminal = true) => ({
  provider: 'toapis', task_id: 'upstream-one-attempt', accepted: true,
  status, terminal, billing_status: billingStatus,
});
const cases: Array<{ id: string; usage?: unknown; task?: unknown }> = [
  { id: 'legacy-no-receipt' },
  { id: 'charged', usage: receipt('failed', 'charged') },
  { id: 'processing', usage: receipt('processing', 'pending', false) },
  { id: 'completed', usage: receipt('completed', 'charged') },
  { id: 'refunded', usage: receipt('failed', 'refunded') },
  { id: 'malformed', usage: { provider: 'toapis' } },
  { id: 'null-receipt', usage: null },
  { id: 'task-only-receipt', task: receipt('failed', 'charged') },
  { id: 'task-only-null-receipt', task: null },
];
const rows = cases.map(test => ({
  id: test.id, userId: 'test-owner', serviceType: 'gpt-image-2',
  createdAt: new Date('2026-10-10T00:00:00.000Z'), consumptionStatus: null, processingTime: 12_345,
  requestParams: { taskId: `task-${test.id}`, ...('usage' in test ? { upstreamImageTask: test.usage } : {}) },
  imageTaskRequestData: 'task' in test ? { upstreamImageTask: test.task } : {},
}));

async function main() {
  let sql = '';
  let values: unknown[] = [];
  const settled: string[] = [];
  const service: any = Object.assign(Object.create(CreditsService.prototype), {
    logger: { log() {}, debug() {}, warn() {}, error() {} },
    getStalePendingTimeoutMinutes: () => 60, getStalePendingBatchSize: () => 100,
    getOrphanImageRefundCutoverAt: () => new Date('2026-10-09T00:00:00.000Z'),
    prisma: { $queryRaw: async (strings: TemplateStringsArray, ...parameters: unknown[]) => {
      values = parameters;
      sql = strings.reduce((result, part, index) => result + part + (index < parameters.length ? `$${index + 1}` : ''), '');
      // Deliberately return excluded rows too: the settlement guard must remain
      // safe with stale selections and with a receipt stored only on ImageTask.
      return rows;
    } },
    markApiUsageFailedForUser: async (_user: string, id: string) => settled.push(`fail:${id}`),
    refundCredits: async (_user: string, id: string) => { settled.push(`refund:${id}`); return {}; },
  });
  const result = await service.autoRefundStalePendingImageUsages();
  assert.equal(result.refunded, 1);
  assert.deepEqual(settled, ['fail:legacy-no-receipt', 'refund:legacy-no-receipt']);

  if (process.env.IMAGE_RECEIPT_TEST_SQL_FILE) {
    const literal = (value: unknown): string => value === null ? 'NULL'
      : typeof value === 'number' ? String(value)
      : `'${String(value instanceof Date ? value.toISOString() : value).replaceAll("'", "''")}'`;
    const query = sql.replace(/\$(\d+)/g, (_match, index) => literal(values[Number(index) - 1]));
    const fixtureInserts = rows.map(row => `
      INSERT INTO "ApiUsageRecord" VALUES (${literal(row.id)},${literal(row.userId)},${literal(row.serviceType)},
        ${literal(row.createdAt)},${literal(JSON.stringify(row.requestParams))}::jsonb,NULL,${row.processingTime},'pending');
      INSERT INTO "ImageTask" VALUES (${literal(row.requestParams.taskId)},${literal(row.userId)},'failed',NULL,
        ${literal(JSON.stringify(row.imageTaskRequestData))}::jsonb,${literal(row.createdAt)},${literal(row.createdAt)},${literal(row.createdAt)});`).join('\n');
    writeFileSync(process.env.IMAGE_RECEIPT_TEST_SQL_FILE, `BEGIN;
      CREATE TEMP TABLE "ApiUsageRecord" (id text, "userId" text, "serviceType" text,
        "createdAt" timestamp, "requestParams" jsonb, "consumptionStatus" text,
        "processingTime" double precision, "responseStatus" text) ON COMMIT DROP;
      CREATE TEMP TABLE "ImageTask" (id text, "userId" text, status text, "imageUrl" text,
        "requestData" jsonb, "createdAt" timestamp, "updatedAt" timestamp, "completedAt" timestamp) ON COMMIT DROP;
      ${fixtureInserts}
      CREATE TEMP TABLE selected_image_orphans ON COMMIT DROP AS ${query};
      DO $assert$ BEGIN
        IF (SELECT count(*) FROM selected_image_orphans) <> 1 OR
          (SELECT id FROM selected_image_orphans LIMIT 1) IS DISTINCT FROM 'legacy-no-receipt' THEN
          RAISE EXCEPTION 'receipt-bearing images must not become age-based refunds';
        END IF;
        RAISE NOTICE 'Image orphan receipt regression: actual production PostgreSQL query PASS';
      END $assert$;
      ROLLBACK;\n`);
  }

  // An optional isolated PostgreSQL run executes the exact captured production
  // query against temporary tables. No business table or ledger is accessed.
  if (process.env.IMAGE_RECEIPT_TEST_DATABASE_URL) {
    const { Client } = require('pg');
    const client = new Client({ connectionString: process.env.IMAGE_RECEIPT_TEST_DATABASE_URL });
    await client.connect();
    try {
      await client.query('BEGIN');
      await client.query(`CREATE TEMP TABLE "ApiUsageRecord" (
        id text, "userId" text, "serviceType" text, "createdAt" timestamp,
        "requestParams" jsonb, "consumptionStatus" text, "processingTime" double precision,
        "responseStatus" text) ON COMMIT DROP`);
      await client.query(`CREATE TEMP TABLE "ImageTask" (
        id text, "userId" text, status text, "imageUrl" text, "requestData" jsonb,
        "createdAt" timestamp, "updatedAt" timestamp, "completedAt" timestamp) ON COMMIT DROP`);
      for (const row of rows) {
        await client.query(`INSERT INTO "ApiUsageRecord" VALUES ($1,$2,$3,$4,$5,NULL,$6,'pending')`,
          [row.id, row.userId, row.serviceType, row.createdAt, row.requestParams, row.processingTime]);
        await client.query(`INSERT INTO "ImageTask" VALUES ($1,$2,'failed',NULL,$3,$4,$4,$4)`,
          [row.requestParams.taskId, row.userId, row.imageTaskRequestData, row.createdAt]);
      }
      const selected = await client.query(sql, values);
      assert.deepEqual(selected.rows.map((row: any) => row.id), ['legacy-no-receipt']);
      console.log('Image orphan receipt regression: settlement guard and actual PostgreSQL query PASS');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      await client.end();
    }
  } else if (!process.env.IMAGE_RECEIPT_TEST_SQL_FILE) {
    console.log('Image orphan receipt regression: settlement guard PASS; PostgreSQL query requires IMAGE_RECEIPT_TEST_DATABASE_URL');
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
