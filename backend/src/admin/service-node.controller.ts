import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { ServiceNodeService } from './services/service-node.service';
import { CreateServiceNodeDto, UpdateServiceNodeDto } from './dto/service-node.dto';

@ApiTags('管理后台 - 节点管理')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('admin/service-nodes')
export class ServiceNodeController {
  constructor(private readonly serviceNodeService: ServiceNodeService) {}

  @Get()
  findAll() {
    return this.serviceNodeService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.serviceNodeService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateServiceNodeDto) {
    return this.serviceNodeService.create(dto);
  }

  @Put(':idOrType')
  async update(@Param('idOrType') idOrType: string, @Body() dto: UpdateServiceNodeDto) {
    // 如果包含连字符，认为是 serviceType
    if (idOrType.includes('-')) {
      return this.serviceNodeService.updateByServiceType(idOrType, dto);
    }
    return this.serviceNodeService.update(idOrType, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serviceNodeService.remove(id);
  }
}
