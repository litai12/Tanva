import {
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
import { BioAuthService } from './bio-auth.service';
import { StartBioAuthDto } from './bio-auth.dto';

@ApiTags('bio-auth')
@UseGuards(ApiKeyOrJwtGuard)
@Controller('bio-auth')
export class BioAuthController {
  private readonly logger = new Logger(BioAuthController.name);

  constructor(private readonly svc: BioAuthService) {}

  private resolveUserId(req: any): string {
    const uid = req?.user?.userId || req?.user?.id || req?.user?.sub;
    if (!uid) throw new BadRequestException('Missing user id in request');
    return String(uid);
  }

  @Post('start')
  async start(@Req() req: any, @Body() dto: StartBioAuthDto) {
    const userId = this.resolveUserId(req);
    this.logger.log(`bio-auth start: user=${userId} imageUrl=${dto.imageUrl.slice(0, 80)}`);
    return this.svc.startTask(userId, dto.imageUrl);
  }

  @Get(':taskId/status')
  status(@Param('taskId') taskId: string) {
    return this.svc.getStatus(taskId);
  }
}
