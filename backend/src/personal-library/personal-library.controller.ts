import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { PersonalLibraryService, type PersonalLibraryAssetType } from './personal-library.service';
import { UpsertPersonalLibraryAssetDto } from './dto/upsert-personal-library-asset.dto';
import { UpdatePersonalLibraryAssetDto } from './dto/update-personal-library-asset.dto';

@ApiTags('personal-library')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('personal-library')
export class PersonalLibraryController {
  constructor(private readonly personalLibrary: PersonalLibraryService) {}

  @Get('assets')
  async list(@Req() req: any, @Query('type') type?: PersonalLibraryAssetType) {
    return this.personalLibrary.listAssets(req.user.sub, type);
  }

  @Post('assets')
  async upsert(@Req() req: any, @Body() dto: UpsertPersonalLibraryAssetDto) {
    return this.personalLibrary.upsertAsset(req.user.sub, dto.asset);
  }

  @Patch('assets/:id')
  async update(@Req() req: any, @Param('id') id: string, @Body() dto: UpdatePersonalLibraryAssetDto) {
    return this.personalLibrary.updateAsset(req.user.sub, id, dto.patch);
  }

  @Delete('assets/:id')
  async remove(@Req() req: any, @Param('id') id: string) {
    return this.personalLibrary.removeAsset(req.user.sub, id);
  }
}

