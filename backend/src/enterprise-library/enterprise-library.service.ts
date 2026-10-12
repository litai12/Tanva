import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { Prisma, type EnterpriseKnowledgeDocument } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from '../team-core/team-core.service';
const categories = ['profile', 'case', 'material', 'process', 'pricing', 'brand'];
type Scope = { scope: 'cloud-personal' | 'team'; teamId?: string };
type RecordValue = Record<string, any>;
const bad = (message: string): never => { throw new BadRequestException(message); };
function object(value: unknown, keys: string[]): RecordValue { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) bad('资料请求格式无效'); return value as RecordValue; }
function text(value: unknown, label: string, max: number, blank = false): string { if (typeof value !== 'string' || (!blank && !value.trim()) || value.length > max || value.includes('\0')) bad(`${label}无效`); return (value as string).trim(); }
const identifier = (value: unknown) => { const id = text(value, '标识', 128); if (!/^[a-zA-Z0-9_-]+$/.test(id)) bad('标识无效'); return id; };
const version = (value: unknown) => { if (!Number.isSafeInteger(value) || Number(value) < 1) bad('必须提供实际资料版本'); return value as number; };
function scopeOf(value: RecordValue): Scope { if (value.scope !== 'cloud-personal' && value.scope !== 'team') bad('必须选择个人云端或团队空间'); if (value.scope === 'team') return { scope: 'team', teamId: identifier(value.teamId) }; if (value.teamId !== undefined) bad('个人资料不能指定团队'); return { scope: 'cloud-personal' }; }
function fields(raw: unknown) {
  const input = object(raw, ['title', 'content', 'summary', 'tags', 'enterprise', 'origin']);
  const title = text(input.title, '标题', 200), content = text(input.content, '内容', 400000);
  const summary = input.summary === undefined ? content.replace(/\s+/g, ' ').slice(0, 160) : text(input.summary, '摘要', 600, true);
  const tags = input.tags ?? []; if (!Array.isArray(tags) || tags.length > 20) bad('标签无效'); const validTags = tags.map((tag: unknown) => text(tag, '标签', 40));
  let enterpriseName: string | null = null, category: string | null = null;
  if (input.enterprise !== undefined && input.enterprise !== null) { const enterprise = object(input.enterprise, ['enterpriseName', 'category']); enterpriseName = text(enterprise.enterpriseName, '企业名称', 120); if (/[\r\n\t]/.test(enterpriseName) || !categories.includes(enterprise.category)) bad('企业归属或分类无效'); category = enterprise.category; }
  const origin = input.origin === undefined ? { source: 'manual' } : object(input.origin, ['source', 'fileName', 'conversationId']);
  if (!['manual', 'import', 'conversation'].includes(origin.source)) bad('资料来源无效');
  if (origin.fileName !== undefined) origin.fileName = text(origin.fileName, '来源文件名', 200);
  if (origin.conversationId !== undefined) origin.conversationId = identifier(origin.conversationId);
  return { title, content, summary, tags: validTags, enterpriseName, category, sha256: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content), origin };
}
@Injectable()
export class EnterpriseLibraryService {
  constructor(private readonly prisma: PrismaService, private readonly teams: TeamCoreService) {}
  async spaces(userId: string) {
    const memberships = await this.prisma.teamMembership.findMany({ where: { userId, team: { status: 'active', isPersonal: false } }, include: { team: true }, orderBy: { createdAt: 'asc' } });
    return [{ scope: 'cloud-personal', name: '个人云端', role: 'owner' }, ...memberships.map(member => ({ scope: 'team', teamId: member.teamId, name: member.team.name, role: member.role }))];
  }
  private async access(userId: string, scope: Scope) { if (scope.scope !== 'team') return 'owner'; const member = await this.teams.assertMember(scope.teamId!, userId); const team = await this.prisma.team.findUnique({ where: { id: scope.teamId } }); if (!team || team.status !== 'active') throw new ForbiddenException('团队不可用'); return member.role; }
  private where(userId: string, scope: Scope) { return scope.scope === 'team' ? { teamId: scope.teamId! } : { ownerId: userId, teamId: null }; }
  private canWrite(userId: string, row: EnterpriseKnowledgeDocument, role: string) { return row.ownerId === userId || ['owner', 'admin'].includes(role); }
  private dto(row: EnterpriseKnowledgeDocument, role: string, userId: string, snapshot?: RecordValue, revisionCreatedAt?: Date, content = true) {
    const data: RecordValue = snapshot ?? row;
    const result: RecordValue = { id: row.id, title: data.title, summary: data.summary, tags: data.tags, scope: row.teamId ? 'team' : 'cloud-personal', ...(row.teamId ? { teamId: row.teamId } : {}), bytes: data.bytes, sha256: data.sha256,
      version: data.version ?? row.version, createdAt: row.createdAt.getTime(), updatedAt: (revisionCreatedAt ?? row.updatedAt).getTime(), sync: 'synced', author: row.ownerId, canWrite: this.canWrite(userId, row, role), origin: data.origin ?? { source: 'manual' },
      ...(data.enterpriseName ? { enterprise: { enterpriseName: data.enterpriseName, category: data.category } } : {}) };
    if (content) result.content = data.content; return result;
  }
  async list(userId: string, input: RecordValue) {
    object(input, ['scope', 'teamId', 'query', 'enterpriseName', 'category', 'cursor', 'limit']);
    const scope = scopeOf(input), role = await this.access(userId, scope);
    const query = input.query === undefined ? '' : text(input.query, '检索词', 500, true);
    const queryTerms = query.split(/[\s,，。；;]+/).filter(Boolean).slice(0, 12);
    const company = input.enterpriseName === undefined ? undefined : text(input.enterpriseName, '企业名称', 120);
    if (input.category !== undefined && !categories.includes(input.category)) bad('资料分类无效');
    const skip = input.cursor === undefined ? 0 : Number(input.cursor), take = input.limit === undefined ? 200 : Number(input.limit);
    if (!Number.isSafeInteger(skip) || skip < 0 || skip > 100000 || !Number.isSafeInteger(take) || take < 1 || take > 200) bad('资料分页无效');
    const rows = await this.prisma.enterpriseKnowledgeDocument.findMany({ where: { ...this.where(userId, scope), deletedAt: null, ...(company ? { enterpriseName: company } : {}), ...(input.category ? { category: input.category } : {}), ...(query ? { OR: queryTerms.flatMap(term => ['title', 'summary', 'content', 'enterpriseName'].map(field => ({ [field]: { contains: term, mode: 'insensitive' } }))) } : {}) }, orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }], skip, take: take + 1 });
    return { items: rows.slice(0, take).map(row => this.dto(row, role, userId, undefined, undefined, false)), ...(rows.length > take ? { nextCursor: String(skip + take) } : {}) };
  }
  async get(userId: string, id: string, input: RecordValue) {
    object(input, ['scope', 'teamId', 'version']); identifier(id); const scope = scopeOf(input), role = await this.access(userId, scope);
    const row = await this.prisma.enterpriseKnowledgeDocument.findFirst({ where: { id, ...this.where(userId, scope) } });
    if (!row || (row.deletedAt && input.version === undefined)) throw new NotFoundException('资料不存在');
    const selectedVersion = input.version === undefined ? row.version : version(Number(input.version));
    const revision = await this.prisma.enterpriseKnowledgeRevision.findUnique({ where: { documentId_version: { documentId: row.id, version: selectedVersion } } });
    if (!revision) throw new NotFoundException('资料版本不存在');
    return this.dto(row, role, userId, revision.snapshot as RecordValue, revision.createdAt);
  }
  async create(userId: string, input: RecordValue) {
    object(input, ['id', 'scope', 'teamId', 'draft']); const id = identifier(input.id), scope = scopeOf(input), data = fields(input.draft); await this.access(userId, scope);
    try { return await this.prisma.$transaction(async tx => {
      if (scope.teamId) await this.assertTransactionMember(tx, scope.teamId, userId);
      const existing = await tx.enterpriseKnowledgeDocument.findUnique({ where: { id } });
      if (existing) { const accepted = await tx.enterpriseKnowledgeRevision.findUnique({ where: { documentId_version: { documentId: id, version: 1 } } }); if (existing.ownerId !== userId || existing.teamId !== (scope.teamId ?? null) || !accepted || !isDeepStrictEqual(accepted.snapshot, { ...data, version: 1 }) || existing.deletedAt) throw new ConflictException('资料创建标识已使用，请刷新'); return this.dto(existing, 'member', userId, accepted.snapshot as RecordValue, accepted.createdAt); }
      const stored = data;
      const row = await tx.enterpriseKnowledgeDocument.create({ data: { id, ownerId: userId, teamId: scope.teamId ?? null, ...stored } });
      await tx.enterpriseKnowledgeRevision.create({ data: { documentId: id, version: 1, actorId: userId, snapshot: { ...data, version: 1 } } });
      return this.dto(row, 'member', userId, { ...data, version: 1 });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { return this.transactionFailure(error); }
  }
  private async assertTransactionMember(tx: Prisma.TransactionClient, teamId: string, userId: string) { const member = await tx.teamMembership.findUnique({ where: { teamId_userId: { teamId, userId } } }); if (!member) throw new ForbiddenException('非团队成员'); return member.role; }
  private transactionFailure(error: unknown): never { if (error instanceof Prisma.PrismaClientKnownRequestError && ['P2034', 'P2002'].includes(error.code)) throw new ConflictException('资料并发变化，请刷新后再试'); throw error; }
  async update(userId: string, id: string, input: RecordValue) {
    object(input, ['scope', 'teamId', 'expectedVersion', 'draft']); identifier(id); const scope = scopeOf(input), expectedVersion = version(input.expectedVersion), data = fields(input.draft); await this.access(userId, scope);
    try { return await this.prisma.$transaction(async tx => {
      const role = scope.teamId ? await this.assertTransactionMember(tx, scope.teamId, userId) : 'owner';
      const row = await tx.enterpriseKnowledgeDocument.findFirst({ where: { id, ...this.where(userId, scope), deletedAt: null } });
      if (!row) throw new NotFoundException('资料不存在'); if (!this.canWrite(userId, row, role)) throw new ForbiddenException('仅资料创建者或团队管理员可修改');
      const stored = data;
      const changed = await tx.enterpriseKnowledgeDocument.updateMany({ where: { id, version: expectedVersion, deletedAt: null }, data: { ...stored, version: { increment: 1 } } });
      if (!changed.count) throw new ConflictException('资料版本已变化，请刷新后再编辑');
      const next = await tx.enterpriseKnowledgeDocument.findUniqueOrThrow({ where: { id } });
      await tx.enterpriseKnowledgeRevision.create({ data: { documentId: id, version: next.version, actorId: userId, snapshot: { ...data, version: next.version } } });
      return this.dto(next, role, userId, { ...data, version: next.version });
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { return this.transactionFailure(error); }
  }
  async remove(userId: string, id: string, input: RecordValue) {
    object(input, ['scope', 'teamId', 'expectedVersion']); identifier(id); const scope = scopeOf(input), expectedVersion = version(Number(input.expectedVersion)); await this.access(userId, scope);
    try { return await this.prisma.$transaction(async tx => {
      const role = scope.teamId ? await this.assertTransactionMember(tx, scope.teamId, userId) : 'owner';
      const row = await tx.enterpriseKnowledgeDocument.findFirst({ where: { id, ...this.where(userId, scope), deletedAt: null } });
      if (!row) throw new NotFoundException('资料不存在'); if (!this.canWrite(userId, row, role)) throw new ForbiddenException('仅资料创建者或团队管理员可删除');
      const removed = await tx.enterpriseKnowledgeDocument.updateMany({ where: { id, version: expectedVersion, deletedAt: null }, data: { deletedAt: new Date() } });
      if (!removed.count) throw new ConflictException('资料版本已变化，请刷新后再删除'); return { deleted: true };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); } catch (error) { return this.transactionFailure(error); }
  }
}
