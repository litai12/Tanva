import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TeamCoreService } from '../team-core/team-core.service';
import {
  CreateMaterialAssetDto,
  CreateMaterialFolderDto,
  CreateTeamMaterialAssetDto,
  MATERIAL_KINDS,
  MaterialKind,
  UpdateMaterialAssetDto,
} from './dto/material-library.dto';
import type { MaterialAsset, MaterialFolder } from '@prisma/client';

export interface MaterialAssetVersionDto {
  id: string;
  assetId: string;
  version: number;
  data: Record<string, unknown>;
  note: string | null;
  createdAt: string;
}

export interface MaterialAssetDto {
  id: string;
  teamId: string | null;
  folderId: string | null;
  kind: MaterialKind;
  name: string;
  favorite: boolean;
  currentVersion: number;
  latestVersion: MaterialAssetVersionDto | null;
  createdAt: string;
  updatedAt: string;
}

export interface MaterialFolderDto {
  id: string;
  ownerId: string | null;
  teamId: string | null;
  name: string;
  createdAt: string;
}

@Injectable()
export class MaterialLibraryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly teamCore: TeamCoreService,
  ) {}

  // ── helpers ────────────────────────────────────────────────────────────────

  /**
   * 资产 data 只允许存放远端 URL / OSS key 等可持久化引用，
   * 拒绝 data: / blob: / 裸 base64（与全站「设计 JSON 不落临时引用」一致）。
   */
  private sanitizeData(data: Record<string, unknown>): Record<string, unknown> {
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      throw new BadRequestException('素材数据格式不正确');
    }
    const urlKeys = ['imageUrl', 'url', 'thumbnailUrl'];
    for (const key of urlKeys) {
      const value = data[key];
      if (typeof value !== 'string') continue;
      const trimmed = value.trim();
      if (!trimmed) continue;
      if (
        trimmed.startsWith('data:') ||
        trimmed.startsWith('blob:')
      ) {
        throw new BadRequestException(
          `素材数据 ${key} 不能是临时引用（data:/blob:），请先上传换取远端地址`,
        );
      }
    }
    return data;
  }

  private toVersionDto(asset: MaterialAsset): MaterialAssetVersionDto {
    return {
      id: `${asset.id}-v${asset.currentVersion}`,
      assetId: asset.id,
      version: asset.currentVersion,
      data: (asset.data as Record<string, unknown>) ?? {},
      note: null,
      createdAt: asset.updatedAt.toISOString(),
    };
  }

  private toAssetDto(asset: MaterialAsset): MaterialAssetDto {
    return {
      id: asset.id,
      teamId: asset.teamId,
      folderId: asset.folderId,
      kind: asset.kind as MaterialKind,
      name: asset.name,
      favorite: asset.favorite,
      currentVersion: asset.currentVersion,
      latestVersion: this.toVersionDto(asset),
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
    };
  }

  private toFolderDto(folder: MaterialFolder): MaterialFolderDto {
    return {
      id: folder.id,
      ownerId: folder.ownerId,
      teamId: folder.teamId,
      name: folder.name,
      createdAt: folder.createdAt.toISOString(),
    };
  }

  private normalizeKind(kind?: string): MaterialKind | undefined {
    return (MATERIAL_KINDS as readonly string[]).includes(kind ?? '')
      ? (kind as MaterialKind)
      : undefined;
  }

  /** 校验 folderId 属于当前作用域（个人或指定团队），否则报错。 */
  private async assertFolderScope(
    folderId: string | null | undefined,
    scope: { userId: string; teamId: string | null },
  ): Promise<void> {
    if (!folderId) return;
    const folder = await this.prisma.materialFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('文件夹不存在');
    if (scope.teamId) {
      if (folder.teamId !== scope.teamId) {
        throw new ForbiddenException('文件夹不属于该团队');
      }
    } else {
      if (folder.ownerId !== scope.userId || folder.teamId) {
        throw new ForbiddenException('文件夹不属于当前用户');
      }
    }
  }

  // ── personal assets ─────────────────────────────────────────────────────────

  async listPersonalAssets(
    userId: string,
    kind?: string,
  ): Promise<MaterialAssetDto[]> {
    const rows = await this.prisma.materialAsset.findMany({
      where: { ownerId: userId, teamId: null, kind: this.normalizeKind(kind) },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => this.toAssetDto(r));
  }

  async createPersonalAsset(
    userId: string,
    dto: CreateMaterialAssetDto,
  ): Promise<MaterialAssetDto> {
    await this.assertFolderScope(dto.folderId, { userId, teamId: null });
    const row = await this.prisma.materialAsset.create({
      data: {
        ownerId: userId,
        teamId: null,
        folderId: dto.folderId ?? null,
        kind: dto.kind,
        name: dto.name,
        data: this.sanitizeData(dto.initialData) as any,
      },
    });
    return this.toAssetDto(row);
  }

  async updatePersonalAsset(
    userId: string,
    assetId: string,
    dto: UpdateMaterialAssetDto,
  ): Promise<MaterialAssetDto> {
    const existing = await this.prisma.materialAsset.findUnique({
      where: { id: assetId },
    });
    if (!existing || existing.ownerId !== userId || existing.teamId) {
      throw new NotFoundException('素材不存在');
    }
    if (dto.folderId !== undefined) {
      await this.assertFolderScope(dto.folderId, { userId, teamId: null });
    }
    const row = await this.applyAssetUpdate(assetId, dto);
    return this.toAssetDto(row);
  }

  async deletePersonalAsset(userId: string, assetId: string): Promise<void> {
    const existing = await this.prisma.materialAsset.findUnique({
      where: { id: assetId },
    });
    if (!existing || existing.ownerId !== userId || existing.teamId) {
      throw new NotFoundException('素材不存在');
    }
    await this.prisma.materialAsset.delete({ where: { id: assetId } });
  }

  // ── team assets ──────────────────────────────────────────────────────────────

  async listTeamAssets(
    userId: string,
    teamId: string,
    kind?: string,
  ): Promise<MaterialAssetDto[]> {
    await this.teamCore.assertMember(teamId, userId);
    const rows = await this.prisma.materialAsset.findMany({
      where: { teamId, kind: this.normalizeKind(kind) },
      orderBy: { updatedAt: 'desc' },
    });
    return rows.map((r) => this.toAssetDto(r));
  }

  async createTeamAsset(
    userId: string,
    dto: CreateTeamMaterialAssetDto,
  ): Promise<MaterialAssetDto> {
    await this.teamCore.assertMember(dto.teamId, userId);
    await this.assertFolderScope(dto.folderId, { userId, teamId: dto.teamId });
    const row = await this.prisma.materialAsset.create({
      data: {
        ownerId: userId,
        teamId: dto.teamId,
        folderId: dto.folderId ?? null,
        kind: dto.kind,
        name: dto.name,
        data: this.sanitizeData(dto.initialData) as any,
      },
    });
    return this.toAssetDto(row);
  }

  async updateTeamAsset(
    userId: string,
    assetId: string,
    dto: UpdateMaterialAssetDto,
  ): Promise<MaterialAssetDto> {
    const existing = await this.prisma.materialAsset.findUnique({
      where: { id: assetId },
    });
    if (!existing || !existing.teamId) throw new NotFoundException('素材不存在');
    await this.teamCore.assertMember(existing.teamId, userId);
    if (dto.folderId !== undefined) {
      await this.assertFolderScope(dto.folderId, {
        userId,
        teamId: existing.teamId,
      });
    }
    const row = await this.applyAssetUpdate(assetId, dto);
    return this.toAssetDto(row);
  }

  async deleteTeamAsset(userId: string, assetId: string): Promise<void> {
    const existing = await this.prisma.materialAsset.findUnique({
      where: { id: assetId },
    });
    if (!existing || !existing.teamId) throw new NotFoundException('素材不存在');
    await this.teamCore.assertMember(existing.teamId, userId);
    await this.prisma.materialAsset.delete({ where: { id: assetId } });
  }

  /** 共用的字段更新：仅当 data 变化时原子自增 currentVersion。 */
  private applyAssetUpdate(assetId: string, dto: UpdateMaterialAssetDto) {
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.favorite !== undefined) data.favorite = dto.favorite;
    if (dto.folderId !== undefined) data.folderId = dto.folderId;
    if (dto.kind !== undefined) data.kind = dto.kind;
    if (dto.data !== undefined) {
      data.data = this.sanitizeData(dto.data);
      data.currentVersion = { increment: 1 };
    }
    return this.prisma.materialAsset.update({
      where: { id: assetId },
      data: data as any,
    });
  }

  // ── folders ──────────────────────────────────────────────────────────────────

  async listFolders(
    userId: string,
    teamId?: string,
  ): Promise<MaterialFolderDto[]> {
    if (teamId) {
      await this.teamCore.assertMember(teamId, userId);
      const rows = await this.prisma.materialFolder.findMany({
        where: { teamId },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => this.toFolderDto(r));
    }
    const rows = await this.prisma.materialFolder.findMany({
      where: { ownerId: userId, teamId: null },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => this.toFolderDto(r));
  }

  async createFolder(
    userId: string,
    dto: CreateMaterialFolderDto,
  ): Promise<MaterialFolderDto> {
    if (dto.teamId) {
      await this.teamCore.assertMember(dto.teamId, userId);
      const row = await this.prisma.materialFolder.create({
        data: { teamId: dto.teamId, ownerId: null, name: dto.name },
      });
      return this.toFolderDto(row);
    }
    const row = await this.prisma.materialFolder.create({
      data: { ownerId: userId, teamId: null, name: dto.name },
    });
    return this.toFolderDto(row);
  }

  async deleteFolder(userId: string, folderId: string): Promise<void> {
    const folder = await this.prisma.materialFolder.findUnique({
      where: { id: folderId },
    });
    if (!folder) throw new NotFoundException('文件夹不存在');
    if (folder.teamId) {
      await this.teamCore.assertMember(folder.teamId, userId);
    } else if (folder.ownerId !== userId) {
      throw new ForbiddenException('无权删除该文件夹');
    }
    // 文件夹内素材回落到固定 kind 文件夹（folderId=null），不级联删除素材。
    await this.prisma.$transaction([
      this.prisma.materialAsset.updateMany({
        where: { folderId },
        data: { folderId: null },
      }),
      this.prisma.materialFolder.delete({ where: { id: folderId } }),
    ]);
  }
}
