export type VolcAssetClientError = {
  statusCode: 400 | 502;
  message: string;
  code: string;
  upstreamCode?: string;
  requestId?: string;
};

export class VolcAssetUpstreamError extends Error {
  constructor(
    readonly action: string,
    readonly httpStatus: number,
    readonly upstreamCode?: string,
    readonly upstreamMessage?: string,
    readonly requestId?: string,
  ) {
    const detail = upstreamCode
      ? `[${upstreamCode}] ${upstreamMessage || ''}`.trim()
      : upstreamMessage || `HTTP ${httpStatus}`;
    super(`${action}: ${detail}`);
    this.name = 'VolcAssetUpstreamError';
  }
}

export class VolcAssetReviewRejectedError extends Error {
  constructor(readonly auditMessage?: string) {
    super(auditMessage || '内容审核未通过');
    this.name = 'VolcAssetReviewRejectedError';
  }
}

const isCode = (code: string, suffix: string): boolean =>
  code.toLowerCase().endsWith(suffix.toLowerCase());

export function toVolcAssetClientError(error: unknown): VolcAssetClientError {
  if (error instanceof VolcAssetReviewRejectedError) {
    return {
      statusCode: 400,
      code: 'VOLC_ASSET_REVIEW_REJECTED',
      message: '图片内容审核未通过，请更换图片后重试。',
    };
  }

  if (error instanceof VolcAssetUpstreamError) {
    const upstreamCode = error.upstreamCode?.trim();
    const common = {
      upstreamCode,
      requestId: error.requestId?.trim() || undefined,
    };

    if (upstreamCode && isCode(upstreamCode, 'WidthTooSmall')) {
      return {
        statusCode: 400,
        code: 'VOLC_ASSET_IMAGE_WIDTH_TOO_SMALL',
        message: '图片宽度过小，请更换分辨率更高的图片后重试。',
        ...common,
      };
    }

    if (upstreamCode && isCode(upstreamCode, 'HeightTooSmall')) {
      return {
        statusCode: 400,
        code: 'VOLC_ASSET_IMAGE_HEIGHT_TOO_SMALL',
        message: '图片高度过小，请更换分辨率更高的图片后重试。',
        ...common,
      };
    }

    if (
      upstreamCode &&
      (isCode(upstreamCode, 'WidthTooLarge') || isCode(upstreamCode, 'HeightTooLarge'))
    ) {
      return {
        statusCode: 400,
        code: 'VOLC_ASSET_IMAGE_DIMENSIONS_TOO_LARGE',
        message: '图片尺寸过大，请缩小图片后重试。',
        ...common,
      };
    }

    if (upstreamCode?.toLowerCase().startsWith('invalidparameter.')) {
      return {
        statusCode: 400,
        code: 'VOLC_ASSET_INVALID_IMAGE',
        message: '图片不符合素材审核要求，请检查图片格式和尺寸后重试。',
        ...common,
      };
    }

    return {
      statusCode: 502,
      code: 'VOLC_ASSET_UPSTREAM_ERROR',
      message: '图片审核服务暂时不可用，请稍后重试。',
      ...common,
    };
  }

  return {
    statusCode: 502,
    code: 'VOLC_ASSET_UPLOAD_FAILED',
    message: '图片审核失败，请稍后重试。',
  };
}
