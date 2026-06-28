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
import { CanvasCommentsService } from './canvas-comments.service';
import {
  CreateReplyDto,
  CreateThreadDto,
  EditCommentDto,
  MoveThreadDto,
  ResolveThreadDto,
} from './dto/canvas-comment.dto';

@ApiTags('canvas-comments')
@ApiCookieAuth('access_token')
@UseGuards(JwtAuthGuard)
@Controller('canvas')
export class CanvasCommentsController {
  constructor(private readonly comments: CanvasCommentsService) {}

  @Get(':projectId/comments')
  async list(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Query('includeResolved') includeResolved?: string,
  ) {
    return this.comments.listThreads(
      projectId,
      req.user.sub,
      teamId || undefined,
      req.user.role,
      includeResolved === 'true' || includeResolved === '1',
    );
  }

  @Post(':projectId/comments')
  async createThread(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CreateThreadDto,
  ) {
    return this.comments.createThread(projectId, req.user.sub, teamId || undefined, req.user.role, dto);
  }

  @Post(':projectId/comments/:threadId/replies')
  async reply(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('threadId') threadId: string,
    @Query('teamId') teamId: string,
    @Body() dto: CreateReplyDto,
  ) {
    return this.comments.addReply(projectId, threadId, req.user.sub, teamId || undefined, req.user.role, dto);
  }

  @Patch(':projectId/comments/:threadId/resolve')
  async resolve(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('threadId') threadId: string,
    @Query('teamId') teamId: string,
    @Body() dto: ResolveThreadDto,
  ) {
    return this.comments.setResolved(
      projectId,
      threadId,
      req.user.sub,
      teamId || undefined,
      req.user.role,
      dto.resolved,
    );
  }

  @Patch(':projectId/comments/:threadId/position')
  async move(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('threadId') threadId: string,
    @Query('teamId') teamId: string,
    @Body() dto: MoveThreadDto,
  ) {
    return this.comments.moveThread(
      projectId,
      threadId,
      req.user.sub,
      teamId || undefined,
      req.user.role,
      dto.x,
      dto.y,
    );
  }

  @Patch(':projectId/comments/:commentId')
  async edit(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('commentId') commentId: string,
    @Query('teamId') teamId: string,
    @Body() dto: EditCommentDto,
  ) {
    return this.comments.editComment(projectId, commentId, req.user.sub, teamId || undefined, req.user.role, dto);
  }

  @Delete(':projectId/comments/:commentId')
  async remove(
    @Req() req: any,
    @Param('projectId') projectId: string,
    @Param('commentId') commentId: string,
    @Query('teamId') teamId: string,
  ) {
    return this.comments.deleteComment(
      projectId,
      commentId,
      req.user.sub,
      teamId || undefined,
      req.user.role,
    );
  }
}
