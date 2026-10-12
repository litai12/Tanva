import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { EnterpriseLibraryService } from './enterprise-library.service';
@UseGuards(JwtAuthGuard)
@Controller('enterprise-library')
export class EnterpriseLibraryController {
  constructor(private readonly library: EnterpriseLibraryService) {}
  @Get('spaces') spaces(@Req() request: any) { return this.library.spaces(request.user.sub); }
  @Get('documents') list(@Req() request: any, @Query() query: Record<string, unknown>) { return this.library.list(request.user.sub, query); }
  @Post('documents') create(@Req() request: any, @Body() body: any) { return this.library.create(request.user.sub, body); }
  @Get('documents/:id') get(@Req() request: any, @Param('id') id: string, @Query() query: Record<string, unknown>) { return this.library.get(request.user.sub, id, query); }
  @Patch('documents/:id') update(@Req() request: any, @Param('id') id: string, @Body() body: any) { return this.library.update(request.user.sub, id, body); }
  @Delete('documents/:id') remove(@Req() request: any, @Param('id') id: string, @Query() query: Record<string, unknown>) { return this.library.remove(request.user.sub, id, query); }
}
