import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import {
  CreateUserPromptDto,
  ListOfficialPromptsDto,
  ListUserPromptsDto,
  PROMPT_LIBRARY_SOURCES,
  SetPromptFavoriteDto,
  type PromptLibrarySource,
  UpdateUserPromptDto,
} from './dto/prompt-library.dto';
import { PromptLibraryService } from './prompt-library.service';

@ApiTags('prompt-library')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('prompt-library')
export class PromptLibraryController {
  constructor(private readonly promptLibrary: PromptLibraryService) {}

  @Get('official')
  @ApiOperation({ summary: '读取 TapCanvas 官方提示词案例库' })
  listOfficial(@Query() query: ListOfficialPromptsDto) {
    return this.promptLibrary.listOfficial(query);
  }

  @Get('mine')
  @ApiOperation({ summary: '读取当前用户保存的提示词' })
  listMine(@Req() req: any, @Query() query: ListUserPromptsDto) {
    return this.promptLibrary.listMine(req.user.sub, query);
  }

  @Post('mine')
  @ApiOperation({ summary: '创建当前用户的提示词' })
  createMine(@Req() req: any, @Body() dto: CreateUserPromptDto) {
    return this.promptLibrary.createMine(req.user.sub, dto);
  }

  @Patch('mine/:id')
  @ApiOperation({ summary: '更新当前用户的提示词' })
  updateMine(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateUserPromptDto,
  ) {
    return this.promptLibrary.updateMine(req.user.sub, id, dto);
  }

  @Delete('mine/:id')
  @ApiOperation({ summary: '删除当前用户的提示词' })
  removeMine(@Req() req: any, @Param('id') id: string) {
    return this.promptLibrary.removeMine(req.user.sub, id);
  }

  @Get('favorites')
  @ApiOperation({ summary: '读取当前用户的常用提示词' })
  listFavorites(@Req() req: any) {
    return this.promptLibrary.listFavorites(req.user.sub);
  }

  @Put('favorites/:source/:promptId')
  @ApiOperation({ summary: '设置官方或自定义提示词为常用' })
  setFavorite(
    @Req() req: any,
    @Param('source') source: string,
    @Param('promptId') promptId: string,
    @Body() dto: SetPromptFavoriteDto,
  ) {
    if (!PROMPT_LIBRARY_SOURCES.includes(source as PromptLibrarySource)) {
      throw new BadRequestException('提示词来源无效');
    }
    return this.promptLibrary.setFavorite(
      req.user.sub,
      source as PromptLibrarySource,
      promptId,
      dto.favorite,
    );
  }
}
