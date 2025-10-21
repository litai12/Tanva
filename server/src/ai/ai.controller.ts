import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AiService } from './ai.service';
import { ImageGenerationService } from './image-generation.service';
import { ToolSelectionRequestDto } from './dto/tool-selection.dto';
import {
  GenerateImageDto,
  EditImageDto,
  BlendImagesDto,
  AnalyzeImageDto,
  TextChatDto,
} from './dto/image-generation.dto';

@ApiTags('ai')
@Controller('ai')
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly imageGeneration: ImageGenerationService,
  ) {}

  @Post('tool-selection')
  async toolSelection(@Body() dto: ToolSelectionRequestDto) {
    const result = await this.ai.runToolSelectionPrompt(dto.prompt);
    return result;
  }

  @Post('generate-image')
  async generateImage(@Body() dto: GenerateImageDto) {
    const result = await this.imageGeneration.generateImage(dto);
    return result;
  }

  @Post('edit-image')
  async editImage(@Body() dto: EditImageDto) {
    const result = await this.imageGeneration.editImage(dto);
    return result;
  }

  @Post('blend-images')
  async blendImages(@Body() dto: BlendImagesDto) {
    const result = await this.imageGeneration.blendImages(dto);
    return result;
  }

  @Post('analyze-image')
  async analyzeImage(@Body() dto: AnalyzeImageDto) {
    const result = await this.imageGeneration.analyzeImage(dto);
    return result;
  }

  @Post('text-chat')
  async textChat(@Body() dto: TextChatDto) {
    const result = await this.imageGeneration.generateTextResponse(dto);
    return result;
  }
}

