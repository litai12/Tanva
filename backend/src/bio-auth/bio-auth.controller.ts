import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { BioAuthService } from './bio-auth.service';
import { StartBioAuthDto, CreateAssetInGroupDto } from './bio-auth.dto';

@ApiTags('bio-auth')
@Controller('bio-auth')
export class BioAuthController {
  private readonly logger = new Logger(BioAuthController.name);

  constructor(private readonly svc: BioAuthService) {}

  private resolveUserId(req: any): string {
    const uid = req?.user?.userId || req?.user?.id || req?.user?.sub;
    if (!uid) throw new BadRequestException('Missing user id in request');
    return String(uid);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Post('start')
  async start(@Req() req: any, @Body() dto: StartBioAuthDto) {
    const userId = this.resolveUserId(req);
    this.logger.log(`bio-auth start: user=${userId} imageUrl=${dto.imageUrl.slice(0, 80)}`);
    return this.svc.startTask(userId, dto.imageUrl);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Get(':taskId/status')
  status(@Param('taskId') taskId: string) {
    return this.svc.getStatus(taskId);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Get('groups')
  async groups(@Req() req: any) {
    const userId = this.resolveUserId(req);
    return this.svc.listGroups(userId);
  }

  @UseGuards(ApiKeyOrJwtGuard)
  @Post('asset')
  async createAsset(@Req() req: any, @Body() dto: CreateAssetInGroupDto) {
    const userId = this.resolveUserId(req);
    this.logger.log(`bio-auth createAsset: user=${userId} groupId=${dto.groupId.slice(0, 20)}…`);
    return this.svc.createAssetInGroup(userId, dto.groupId, dto.imageUrl);
  }

  // 火山引擎活体检测回调（无需认证，由火山引擎服务器调用）
  @Get('callback')
  async callback(
    @Query('bytedToken') bytedToken: string,
    @Query('resultCode') resultCode: string,
  ) {
    if (!bytedToken) throw new BadRequestException('Missing bytedToken');
    this.logger.log(`bio-auth callback: bytedToken=${bytedToken.slice(0, 20)}… resultCode=${resultCode}`);
    await this.svc.handleCallback(bytedToken, resultCode ?? '');
    return { ok: true };
  }
}
