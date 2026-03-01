import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class RemoveBackgroundDto {
  @IsString()
  @IsNotEmpty()
  imageData!: string; // base64编码的图像或URL

  @IsOptional()
  @IsString()
  mimeType?: string; // 图像MIME类型,默认为 'image/png'

  @IsOptional()
  @IsString()
  source?: 'base64' | 'url' | 'file'; // 数据源类型,默认为 'base64'
}
