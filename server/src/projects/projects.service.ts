import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OssService } from '../oss/oss.service';

@Injectable()
export class ProjectsService {
  constructor(private prisma: PrismaService, private oss: OssService) {}

  async list(userId: string) {
    return this.prisma.project.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
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
    const updated = await this.prisma.project.update({ where: { id: project.id }, data: { ossPrefix: prefix, mainKey } });
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
}
