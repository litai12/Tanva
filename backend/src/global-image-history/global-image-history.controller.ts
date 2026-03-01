import { Body, Controller, Delete, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { GlobalImageHistoryService } from './global-image-history.service';
import { CreateGlobalImageHistoryDto, QueryGlobalImageHistoryDto } from './dto/global-image-history.dto';

@ApiTags('global-image-history')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('global-image-history')
export class GlobalImageHistoryController {
  constructor(private readonly service: GlobalImageHistoryService) {}

  @Get()
  async list(@Req() req: any, @Query() query: QueryGlobalImageHistoryDto) {
    return this.service.list(req.user.sub, query);
  }

  @Get('count')
  async count(@Req() req: any) {
    const count = await this.service.getCount(req.user.sub);
    return { count };
  }

  @Post()
  async create(@Req() req: any, @Body() dto: CreateGlobalImageHistoryDto) {
    return this.service.create(req.user.sub, dto);
  }

  @Get(':id')
  async getOne(@Req() req: any, @Param('id') id: string) {
    return this.service.getOne(req.user.sub, id);
  }

  @Delete(':id')
  async delete(@Req() req: any, @Param('id') id: string) {
    return this.service.delete(req.user.sub, id);
  }
}
