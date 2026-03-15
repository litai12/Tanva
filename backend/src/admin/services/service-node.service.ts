import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateServiceNodeDto, UpdateServiceNodeDto } from '../dto/service-node.dto';

@Injectable()
export class ServiceNodeService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.serviceNode.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const node = await this.prisma.serviceNode.findUnique({ where: { id } });
    if (!node) throw new NotFoundException('节点不存在');
    return node;
  }

  async create(dto: CreateServiceNodeDto) {
    const exists = await this.prisma.serviceNode.findUnique({
      where: { serviceType: dto.serviceType },
    });
    if (exists) throw new ConflictException('服务类型已存在');

    return this.prisma.serviceNode.create({ data: dto });
  }

  async update(id: string, dto: UpdateServiceNodeDto) {
    await this.findOne(id);
    return this.prisma.serviceNode.update({ where: { id }, data: dto });
  }

  async updateByServiceType(serviceType: string, dto: UpdateServiceNodeDto) {
    const node = await this.prisma.serviceNode.findUnique({ where: { serviceType } });
    if (!node) throw new NotFoundException('节点不存在');
    return this.prisma.serviceNode.update({ where: { id: node.id }, data: dto });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.serviceNode.delete({ where: { id } });
  }
}
