import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertStoryboardSkillDto } from './dto/upsert-storyboard-skill.dto';

const STORYBOARD_SKILL_PUBLIC_SELECT = {
  id: true,
  name: true,
  content: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class StoryboardSkillsService {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string) {
    return this.prisma.storyboardSkill.findMany({
      where: { userId },
      select: STORYBOARD_SKILL_PUBLIC_SELECT,
      orderBy: [{ updatedAt: 'desc' }],
    });
  }

  async upsert(userId: string, dto: UpsertStoryboardSkillDto) {
    const name = dto.name.trim();
    const content = dto.content.trim();
    if (!name) {
      throw new BadRequestException('Skill 名称不能为空');
    }
    if (!content) {
      throw new BadRequestException('Skill 内容不能为空');
    }

    if (dto.id) {
      const existing = await this.prisma.storyboardSkill.findFirst({
        where: { id: dto.id, userId },
        select: { id: true },
      });
      if (!existing) {
        throw new NotFoundException('Skill 不存在');
      }
      return this.prisma.storyboardSkill.update({
        where: { id: dto.id },
        data: { name, content },
        select: STORYBOARD_SKILL_PUBLIC_SELECT,
      });
    }

    return this.prisma.storyboardSkill.create({
      data: { userId, name, content },
      select: STORYBOARD_SKILL_PUBLIC_SELECT,
    });
  }

  async remove(userId: string, id: string): Promise<{ ok: true }> {
    const existing = await this.prisma.storyboardSkill.findFirst({
      where: { id, userId },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException('Skill 不存在');
    }
    await this.prisma.storyboardSkill.delete({ where: { id } });
    return { ok: true };
  }
}
