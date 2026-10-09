interface CreditGenerationState {
  apiResponseStatus?: string | null;
  generationStatus?: string | null;
  processingTime?: number | null;
}

export function formatCreditGenerationStatus(record: CreditGenerationState): string {
  const labels: Record<string, string> = {
    queued: '排队中', processing: '生成中', succeeded: '生成成功',
    failed: '生成失败', cancelled: '已取消',
  };
  const status = record.generationStatus;
  if (status && labels[status]) {
    const pendingSettlement = record.apiResponseStatus === 'pending' &&
      ['succeeded', 'failed', 'cancelled'].includes(status);
    return labels[status] + (pendingSettlement ? ' · 待核账' : '');
  }
  if (record.apiResponseStatus === 'pending') return '结果待确认';
  if (record.apiResponseStatus === 'failed') return '请求失败';
  if (record.apiResponseStatus === 'success') return '已完成';
  return '-';
}

export function formatCreditProcessingTime(record: CreditGenerationState): string {
  if (typeof record.processingTime === 'number' && Number.isFinite(record.processingTime)) {
    return `${Math.max(0, Math.round(record.processingTime / 1000))}秒`;
  }
  if (record.generationStatus === 'queued' || record.generationStatus === 'processing' ||
      (!record.generationStatus && record.apiResponseStatus === 'pending')) return '待确认';
  return record.generationStatus || record.apiResponseStatus ? '未记录' : '-';
}
