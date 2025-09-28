import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private oss: OssService) {}

  async list(userId: string) {
    const projects = await this.prisma.project.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    return projects.map((p) => ({ ...p, mainUrl: p.mainKey ? this.oss.publicUrl(p.mainKey) : undefined }));
  }

  async create(userId: string, name?: string) {
    const project = await this.prisma.project.create({ data: { userId, name: name || '未命名项目', ossPrefix: '', mainKey: '' } });
    const prefix = `projects/${userId}/${project.id}/`;
    const mainKey = `${prefix}project.json`;
    const payload = {
      id: project.id,
      name: project.name,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: 1,
      canvas: { width: 1920, height: 1080, zoom: 1, background: '#ffffff' },
      layers: [],
      assets: [],
    };
    try {
      await this.oss.putJSON(mainKey, payload);
    } catch (e) {
      // 不中断项目创建，记录日志即可（开发环境未配置 OSS 时）
      // eslint-disable-next-line no-console
      console.warn('OSS putJSON failed, project created without file:', e);
    }
    let updated: any;
    try {
      updated = await this.prisma.project.update({ where: { id: project.id }, data: { ossPrefix: prefix, mainKey, contentJson: payload as any } });
    } catch (e) {
      // 兼容未迁移数据库环境：如果出现未知字段错误，退回不写 contentJson
      // eslint-disable-next-line no-console
      console.warn('DB update with contentJson failed, falling back:', e);
      updated = await this.prisma.project.update({ where: { id: project.id }, data: { ossPrefix: prefix, mainKey } });
    }
    return { ...updated, mainUrl: this.oss.publicUrl(mainKey) };
  }

  async get(userId: string, id: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new UnauthorizedException();
    return { ...p, mainUrl: this.oss.publicUrl(p.mainKey) };
  }

  async rename(userId: string, id: string, name: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new UnauthorizedException();
    const updated = await this.prisma.project.update({ where: { id }, data: { name } });
    return { ...updated, mainUrl: this.oss.publicUrl(updated.mainKey) };
  }

  async remove(userId: string, id: string) {
    const p = await this.prisma.project.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('项目不存在');
    if (p.userId !== userId) throw new UnauthorizedException();
    await this.prisma.project.delete({ where: { id } });
    return { ok: true };
  }

  async getContent(userId: string, id: string) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new UnauthorizedException();

    if (!project.mainKey) {
      return {
        content: (project as any).contentJson || null,
        version: project.contentVersion,
        updatedAt: project.updatedAt,
      };
    }

    try {
      const content = await this.oss.getJSON(project.mainKey);
      return {
        content: content ?? ((project as any).contentJson || null),
        version: project.contentVersion ?? 1,
        updatedAt: project.updatedAt,
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('OSS getJSON failed, returning null content:', err);
      return {
        content: (project as any).contentJson || null,
        version: project.contentVersion ?? 1,
        updatedAt: project.updatedAt,
      };
    }
  }

  async updateContent(userId: string, id: string, content: unknown, version?: number) {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) throw new NotFoundException('项目不存在');
    if (project.userId !== userId) throw new UnauthorizedException();
    const prefix = project.ossPrefix || `projects/${userId}/${project.id}/`;
    const mainKey = project.mainKey || `${prefix}project.json`;

    try {
      await this.oss.putJSON(mainKey, content);
    } catch (err) {
      // 在开发环境中，OSS错误不应该阻止项目内容更新
      // eslint-disable-next-line no-console
      console.warn('OSS putJSON failed, continuing with database update:', err);
      // 不抛出错误，继续更新数据库
    }

    const newVersion = (project.contentVersion ?? 0) + 1;
    let updated2: any;
    try {
      updated2 = await this.prisma.project.update({
        where: { id },
        data: {
          ossPrefix: prefix,
          mainKey,
          contentVersion: newVersion,
          contentJson: content as any,
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('DB update(contentJson) failed, fallback without contentJson:', e);
      updated2 = await this.prisma.project.update({ where: { id }, data: { ossPrefix: prefix, mainKey, contentVersion: newVersion } });
    }

    return {
      version: updated2.contentVersion ?? newVersion,
      updatedAt: updated2.updatedAt,
      mainUrl: updated2.mainKey ? this.oss.publicUrl(updated2.mainKey) : undefined,
    };
  }
}
