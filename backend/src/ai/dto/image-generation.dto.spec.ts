import 'reflect-metadata';
import assert from 'node:assert/strict';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GenerateImageDto } from './image-generation.dto';

async function main() {
  const pipe = new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: false,
    forbidUnknownValues: false,
    skipMissingProperties: false,
    transformOptions: { enableImplicitConversion: true },
  });
  const request = {
    prompt: '测试参考图生成',
    aiProvider: 'nano2',
    model: 'gpt-image-2.5',
    providerOptions: { banana: { imageRoute: 'normal' }, bananaImageRoute: 'normal' },
    aspectRatio: '1:1',
    imageUrls: ['https://assets.example.test/reference.jpg'],
    imageSize: '1K',
    officialFallback: false,
  };
  const validate = (body: Record<string, unknown>) =>
    pipe.transform(body, { type: 'body', metatype: GenerateImageDto });

  for (const quality of ['high', 'xhigh', 'max']) {
    const result = await validate({ ...request, quality });
    assert.equal(result.quality, quality, `quality ${quality} must survive HTTP validation`);
    assert.deepEqual(result.imageUrls, request.imageUrls);
  }
  for (const quality of ['auto', 'low', 'medium', 'high']) {
    const result = await validate({ ...request, model: 'gpt-image-2', quality });
    assert.equal(result.quality, quality, 'preserve GPT-Image-2 compatibility');
  }
  await validate(request);
  for (const quality of ['invalid', 'MAX', 1]) {
    await assert.rejects(validate({ ...request, quality }), BadRequestException);
  }
  for (const thinkingLevel of ['high', 'low']) {
    await validate({ ...request, thinkingLevel });
  }
  for (const thinkingLevel of ['xhigh', 'max']) {
    await assert.rejects(validate({ ...request, thinkingLevel }), BadRequestException);
  }
  console.log('Image generation DTO validation passed: GPT-Image-2.5 quality, legacy quality, invalid values and thinking level.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
