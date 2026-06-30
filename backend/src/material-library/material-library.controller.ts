import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { MaterialLibraryService } from './material-library.service';
import {
  CreateMaterialAssetDto,
  CreateMaterialFolderDto,
  CreateTeamMaterialAssetDto,
  UpdateMaterialAssetDto,
} from './dto/material-library.dto';

@ApiTags('material-library')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('material-library')
export class MaterialLibraryController {
  constructor(private readonly material: MaterialLibraryService) {}

  // ── personal assets ─────────────────────────────────────────────────────────

  @Get('assets')
  listAssets(@Req() req: any, @Query('kind') kind?: string) {
    return this.material.listPersonalAssets(req.user.sub, kind);
  }

  @Post('assets')
  createAsset(@Req() req: any, @Body() dto: CreateMaterialAssetDto) {
    return this.material.createPersonalAsset(req.user.sub, dto);
  }

  @Patch('assets/:id')
  updateAsset(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateMaterialAssetDto,
  ) {
    return this.material.updatePersonalAsset(req.user.sub, id, dto);
  }

  @Delete('assets/:id')
  async deleteAsset(@Req() req: any, @Param('id') id: string) {
    await this.material.deletePersonalAsset(req.user.sub, id);
    return { ok: true };
  }

  // ── team assets ──────────────────────────────────────────────────────────────

  @Get('team-assets')
  listTeamAssets(
    @Req() req: any,
    @Query('teamId') teamId: string,
    @Query('kind') kind?: string,
  ) {
    return this.material.listTeamAssets(req.user.sub, teamId, kind);
  }

  @Post('team-assets')
  createTeamAsset(@Req() req: any, @Body() dto: CreateTeamMaterialAssetDto) {
    return this.material.createTeamAsset(req.user.sub, dto);
  }

  @Patch('team-assets/:id')
  updateTeamAsset(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateMaterialAssetDto,
  ) {
    return this.material.updateTeamAsset(req.user.sub, id, dto);
  }

  @Delete('team-assets/:id')
  async deleteTeamAsset(@Req() req: any, @Param('id') id: string) {
    await this.material.deleteTeamAsset(req.user.sub, id);
    return { ok: true };
  }

  // ── folders ──────────────────────────────────────────────────────────────────

  @Get('folders')
  listFolders(@Req() req: any, @Query('teamId') teamId?: string) {
    return this.material.listFolders(req.user.sub, teamId);
  }

  @Post('folders')
  createFolder(@Req() req: any, @Body() dto: CreateMaterialFolderDto) {
    return this.material.createFolder(req.user.sub, dto);
  }

  @Delete('folders/:id')
  async deleteFolder(@Req() req: any, @Param('id') id: string) {
    await this.material.deleteFolder(req.user.sub, id);
    return { ok: true };
  }
}
