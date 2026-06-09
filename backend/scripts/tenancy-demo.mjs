// 多租户隔离演示：启动后端 → 验证 Host 解析 + 租户隔离 + 逃生舱。
// 用法：cd backend && npm run build && node scripts/tenancy-demo.mjs
// 只读 + 临时上下文，不写入任何数据。
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { AppModule } from '../dist/app.module.js';

const app = await NestFactory.create(AppModule, new FastifyAdapter(), { logger: ['error'] });
app.setGlobalPrefix('api');
await app.init();
const inst = app.getHttpAdapter().getInstance();
const { PrismaService } = await import('../dist/prisma/prisma.service.js');
const { TenantContextService } = await import('../dist/tenancy/tenant-context.service.js');
const prisma = app.get(PrismaService);
const tctx = app.get(TenantContextService);

console.log('\n──── 1) 按域名(Host)解析租户 ────');
for (const host of ['tanvas.cn', 'www.tanvas.cn', 'localhost', '未登记的域名.com']) {
  const r = await inst.inject({ method: 'GET', url: '/api/health', headers: { host } });
  console.log(`  Host=${host.padEnd(20)} → HTTP ${r.statusCode}`);
}
console.log('  (未登记域名默认兜底主站=200；设 TENANT_STRICT_HOST=true 则为 404)');

console.log('\n──── 2) 同一查询，不同租户上下文结果不同(隔离) ────');
const def = await tctx.runAsTenant('default', () => prisma.project.count());
const other = await tctx.runAsTenant('t_nonexistent', () => prisma.project.count());
const plat = await tctx.runAsPlatform(() => prisma.project.count());
console.log(`  主站(default) project = ${def}`);
console.log(`  别的租户       project = ${other}   ← 看不到主站数据 = 隔离生效`);
console.log(`  平台态(超管)   project = ${plat}   ← 逃生舱看全部`);

console.log('\n──── 3) 现有租户 ────');
console.log('  ', JSON.stringify(await prisma.tenant.findMany({ select: { id: true, name: true } })));

console.log('\n结论:', def === plat && other === 0 && def > 0 ? '✅ 隔离正确' : '❌ 异常');
await app.close();
process.exit(0);
