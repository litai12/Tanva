import { IsNumber, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CanvasPatchDto {
  @IsOptional() patch: unknown;
  @IsString() connId!: string;
}

export class CanvasCursorDto {
  @IsNumber() x!: number;
  @IsNumber() y!: number;
  @IsOptional() @IsObject() viewport?: Record<string, number>;
  @IsString() connId!: string;
}

export class CanvasLockDto {
  @IsString() @MaxLength(128) nodeId!: string;
  @IsString() connId!: string;
}

export class CanvasToastDto {
  @IsString() @MaxLength(40) kind!: string;
  @IsString() @MaxLength(200) text!: string;
  @IsOptional() @IsString() connId?: string;
}
