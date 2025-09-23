import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt.guard';
import { UsersService } from './users.service';

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
}
