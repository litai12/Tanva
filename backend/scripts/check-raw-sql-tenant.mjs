#!/usr/bin/env node
// 扫描 src 下所有 $queryRaw/$executeRaw（含 Unsafe 变体）。
// 同一调用附近若未出现 tenant_id 或 ALLOW_RAW_NO_TENANT 注释，则视为违规并使 CI 失败。
// 裸 SQL 绕过 Prisma 租户扩展，必须显式带 tenant_id，或对白名单/平台态场景显式标注豁免。
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');
const offenders = [];
const RE = /\$(queryRaw|queryRawUnsafe|executeRaw|executeRawUnsafe)\b/g;

function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) scan(p);
  }
}

function scan(file) {
  const src = readFileSync(file, 'utf8');
  let m;
  while ((m = RE.exec(src))) {
    // 跳过注释行里的方法名提及（非真实调用）
    const lineStart = src.lastIndexOf('\n', m.index) + 1;
    const lineHead = src.slice(lineStart, m.index);
    const trimmed = lineHead.trimStart();
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

    // 取该调用前后窗口，判断是否带 tenant_id 或豁免注释
    const seg = src.slice(Math.max(0, m.index - 120), m.index + 380);
    if (!/tenant_?id|ALLOW_RAW_NO_TENANT/i.test(seg)) {
      const line = src.slice(0, m.index).split('\n').length;
      offenders.push(`${file}:${line}: ${m[0]}`);
    }
  }
}

walk(ROOT);
if (offenders.length) {
  console.error(
    `\n[raw-sql-tenant] 发现 ${offenders.length} 处未带 tenant_id 且无豁免标注的裸 SQL:\n` +
      offenders.join('\n') +
      `\n\n修复：在 SQL 加 WHERE tenant_id = ...，或对白名单/平台态场景加注释 // ALLOW_RAW_NO_TENANT: <理由>\n`,
  );
  process.exit(1);
}
console.log('[raw-sql-tenant] check passed');
