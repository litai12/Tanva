import assert from 'node:assert/strict';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  toVolcAssetClientError,
  VolcAssetReviewRejectedError,
  VolcAssetUpstreamError,
} from '../src/volc-asset/volc-asset-error.util';
import { VolcAssetService } from '../src/volc-asset/volc-asset.service';
import { VolcAssetController } from '../src/volc-asset/volc-asset.controller';

async function main(): Promise<void> {
  const dimensionCases = [
    {
      upstreamCode: 'InvalidParameter.WidthTooSmall',
      code: 'VOLC_ASSET_IMAGE_WIDTH_TOO_SMALL',
      message: '图片宽度过小，请更换分辨率更高的图片后重试。',
    },
    {
      upstreamCode: 'InvalidParameter.HeightTooSmall',
      code: 'VOLC_ASSET_IMAGE_HEIGHT_TOO_SMALL',
      message: '图片高度过小，请更换分辨率更高的图片后重试。',
    },
  ];

  for (const testCase of dimensionCases) {
    const result = toVolcAssetClientError(
      new VolcAssetUpstreamError(
        'CreateAsset',
        400,
        testCase.upstreamCode,
        'invalid image dimensions',
        'request-123',
      ),
    );
    assert.deepEqual(result, {
      statusCode: 400,
      code: testCase.code,
      message: testCase.message,
      upstreamCode: testCase.upstreamCode,
      requestId: 'request-123',
    });
  }

  const invalidImageResult = toVolcAssetClientError(
    new VolcAssetUpstreamError(
      'CreateAsset',
      400,
      'InvalidParameter.ImageFormat',
      'internal upstream detail',
    ),
  );
  assert.equal(invalidImageResult.statusCode, 400);
  assert.equal(invalidImageResult.code, 'VOLC_ASSET_INVALID_IMAGE');
  assert.equal(
    invalidImageResult.message,
    '图片不符合素材审核要求，请检查图片格式和尺寸后重试。',
  );
  assert.ok(!invalidImageResult.message.includes('internal upstream detail'));

  const unavailableResult = toVolcAssetClientError(
    new VolcAssetUpstreamError('CreateAsset', 503, 'ServiceUnavailable'),
  );
  assert.equal(unavailableResult.statusCode, 502);
  assert.equal(unavailableResult.code, 'VOLC_ASSET_UPSTREAM_ERROR');

  const rejectedResult = toVolcAssetClientError(
    new VolcAssetReviewRejectedError('upstream audit detail'),
  );
  assert.deepEqual(rejectedResult, {
    statusCode: 400,
    code: 'VOLC_ASSET_REVIEW_REJECTED',
    message: '图片内容审核未通过，请更换图片后重试。',
  });

  const controllerError = new VolcAssetUpstreamError(
    'CreateAsset',
    400,
    'InvalidParameter.HeightTooSmall',
    'Image height is too small',
    'request-controller',
  );
  const controller = new VolcAssetController({
    uploadAsset: async () => {
      throw controllerError;
    },
    invalidateTodayGroup: () => undefined,
  } as unknown as VolcAssetService);
  try {
    await controller.upload(
      { user: { userId: 'user-1' } },
      { sourceUrl: 'https://assets.test/image.png', assetType: 'image' },
    );
    assert.fail('Expected controller upload to reject the invalid image');
  } catch (error) {
    assert.ok(error instanceof BadRequestException);
    assert.equal(error.getStatus(), 400);
    assert.deepEqual(error.getResponse(), {
      message: '图片高度过小，请更换分辨率更高的图片后重试。',
      code: 'VOLC_ASSET_IMAGE_HEIGHT_TOO_SMALL',
      upstreamCode: 'InvalidParameter.HeightTooSmall',
      requestId: 'request-controller',
    });
  }

  const config = {
    get: (key: string) =>
      ({
        VOLC_ARK_ACCESS_KEY: 'test-access-key',
        VOLC_ARK_SECRET_KEY: 'test-secret-key',
      } as Record<string, string>)[key],
  } as ConfigService;
  const service = new VolcAssetService(config, {} as PrismaService);
  service.onModuleInit();
  service.ensureTodayGroup = async () => 'group-1';

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        ResponseMetadata: {
          RequestId: 'request-456',
          Error: {
            Code: 'InvalidParameter.WidthTooSmall',
            Message: 'Image width is too small',
          },
        },
      }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );

  try {
    await service.uploadAsset('user-1', 'https://assets.test/image.png', 'image');
    assert.fail('Expected uploadAsset to reject the Ark validation response');
  } catch (error) {
    assert.ok(error instanceof VolcAssetUpstreamError);
    assert.equal(error.action, 'CreateAsset');
    assert.equal(error.httpStatus, 400);
    assert.equal(error.upstreamCode, 'InvalidParameter.WidthTooSmall');
    assert.equal(error.upstreamMessage, 'Image width is too small');
    assert.equal(error.requestId, 'request-456');
  } finally {
    globalThis.fetch = originalFetch;
  }

  console.log('Volc asset error verification passed.');
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
