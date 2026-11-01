import 'reflect-metadata';
import assert from 'node:assert/strict';
import { IsArray, IsBoolean, IsEnum, IsIn, IsInt, IsObject, IsOptional, IsString } from 'class-validator';
import { applyClassValidatorTypes } from './class-validator-schema';

enum Ratio { Square = '1:1', Wide = '16:9' }
enum Level { Low = 1, High = 2 }
class SampleDto {
  @IsEnum(Ratio) ratio!: string;
  @IsEnum(Level) level!: number;
  @IsIn(['a', 'b']) kind!: string;
  @IsOptional() @IsString() provider?: string;
  @IsInt() count!: number;
  @IsBoolean() flag!: boolean;
  @IsObject() options!: Record<string, unknown>;
  @IsArray() @IsIn(['x', 'y'], { each: true }) tags!: string[];
  @IsString() explicit!: string;
  @IsString() ref!: string;
}
const bare = () => ({ type: 'object' });
const doc = { components: { schemas: { SampleDto: { type: 'object', properties: {
  ratio: bare(), level: bare(), kind: bare(), provider: bare(), count: bare(), flag: bare(), options: bare(),
  tags: { type: 'array', items: bare() }, explicit: { type: 'string', maxLength: 5 }, ref: { $ref: '#/components/schemas/X' },
} as Record<string, any> } } } };
void SampleDto;
const fixed = applyClassValidatorTypes(doc as never);
const p = doc.components.schemas.SampleDto.properties;
assert.deepEqual(p.ratio, { type: 'string', enum: ['1:1', '16:9'] });
assert.deepEqual(p.level, { type: 'number', enum: [1, 2] });
assert.deepEqual(p.kind, { type: 'string', enum: ['a', 'b'] });
assert.deepEqual(p.provider, { type: 'string' });
assert.deepEqual(p.count, { type: 'integer' });
assert.deepEqual(p.flag, { type: 'boolean' });
assert.deepEqual(p.options, { type: 'object' }, 'real objects stay objects');
assert.deepEqual(p.tags, { type: 'array', items: { type: 'string', enum: ['x', 'y'] } });
assert.deepEqual(p.explicit, { type: 'string', maxLength: 5 }, 'explicit schemas untouched');
assert.deepEqual(p.ref, { $ref: '#/components/schemas/X' }, 'refs untouched');
assert.equal(fixed, 7);
console.log('openapi class-validator type enrichment checks passed');
