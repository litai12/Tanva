// backend/src/volc-asset/volc-asset.controller.ts
import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ApiKeyOrJwtGuard } from '../auth/guards/api-key-or-jwt.guard';
import { VolcAssetService } from './volc-asset.service';
import { UploadAssetDto } from './volc-asset.dto';

@ApiTags('volc-asset')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('volc-asset')
export class VolcAssetController {
  private readonly logger = new Logger(VolcAssetController.name);
  constructor(private readonly svc: VolcAssetService) {}

  private resolveUserId(req: any): string {
    const uid = req?.user?.userId || req?.user?.id || req?.user?.sub;
    if (!uid) throw new BadRequestException('Missing user id in request');
    return String(uid);
  }

  @Post('upload')
  async upload(@Req() req: any, @Body() dto: UploadAssetDto) {
    const userId = this.resolveUserId(req);
    try {
      const result = await this.svc.uploadAsset(userId, dto.sourceUrl, dto.assetType);
      return result;
    } catch (err: any) {
      const msg = err?.message || 'Volc upload failed';
      if (/Group not found/i.test(msg)) {
        this.svc.invalidateTodayGroup();
      }
      this.logger.error(`upload failed for user ${userId}: ${msg}`);
      throw new BadGatewayException(msg);
    }
  }

  @Get(':assetId/status')
  async status(@Param('assetId') assetId: string) {
    try {
      return await this.svc.getAssetStatus(assetId);
    } catch (err: any) {
      const msg = err?.message || 'Volc status fetch failed';
      this.logger.error(`status failed for ${assetId}: ${msg}`);
      throw new BadGatewayException(msg);
    }
  }
}
