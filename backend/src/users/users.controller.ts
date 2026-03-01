import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UsersService, UpdateGoogleApiKeyDto } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('me')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  async me(@Req() req: any) {
    const userId = req.user.sub as string;
    const user = await this.usersService.findById(userId);
    return this.usersService.sanitize(user);
  }

  @Get('google-api-key')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '获取用户的 Google API Key 设置' })
  async getGoogleApiKey(@Req() req: any) {
    const userId = req.user.sub as string;
    const result = await this.usersService.getGoogleApiKey(userId);
    // 对 API Key 进行脱敏处理
    return {
      hasCustomKey: !!result.apiKey,
      maskedKey: result.apiKey ? `${result.apiKey.slice(0, 8)}...${result.apiKey.slice(-4)}` : null,
      mode: result.mode,
    };
  }

  @Patch('google-api-key')
  @ApiCookieAuth('access_token')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: '更新用户的 Google API Key' })
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        googleCustomApiKey: { type: 'string', nullable: true, description: 'Google Gemini API Key，设为 null 清除' },
        googleKeyMode: { type: 'string', enum: ['official', 'custom'], description: '使用模式' },
      },
    },
  })
  async updateGoogleApiKey(@Req() req: any, @Body() dto: UpdateGoogleApiKeyDto) {
    const userId = req.user.sub as string;
    const result = await this.usersService.updateGoogleApiKey(userId, dto);
    return {
      success: true,
      hasCustomKey: !!result.googleCustomApiKey,
      mode: result.googleKeyMode,
    };
  }
}
