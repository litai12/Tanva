import {
  openDesktopArtifact,
  type DesktopArtifact,
  type DesktopArtifactSheet,
} from '../desktop/artifacts/artifactState';

export interface CreateSpreadsheetArguments {
  title?: unknown;
  sheets?: unknown;
}

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value)
    : value == null
      ? ''
      : JSON.stringify(value);

export const normalizeSpreadsheetSheets = (
  value: unknown
): DesktopArtifactSheet[] => {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 12).flatMap((rawSheet, sheetIndex) => {
    if (!rawSheet || typeof rawSheet !== 'object' || Array.isArray(rawSheet)) return [];
    const sheet = rawSheet as Record<string, unknown>;
    const columns = Array.isArray(sheet.columns)
      ? sheet.columns.slice(0, 30).map(text)
      : [];
    const dataRows = Array.isArray(sheet.rows)
      ? sheet.rows.slice(0, 500).map((rawRow) =>
          Array.isArray(rawRow)
            ? rawRow.slice(0, 30).map(text)
            : rawRow && typeof rawRow === 'object'
              ? columns.map((column) => text((rawRow as Record<string, unknown>)[column]))
              : [text(rawRow)]
        )
      : [];
    const rows = columns.length > 0 ? [columns, ...dataRows] : dataRows;
    if (rows.length === 0) return [];
    return [{
      name:
        typeof sheet.name === 'string' && sheet.name.trim()
          ? sheet.name.trim().slice(0, 31)
          : `Sheet${sheetIndex + 1}`,
      rows,
    }];
  });
};

export const createSpreadsheetFromXiaot = (
  args: CreateSpreadsheetArguments,
  fallbackTitle = '小T工作簿'
): DesktopArtifact => {
  const sheets = normalizeSpreadsheetSheets(args.sheets);
  if (sheets.length === 0) {
    throw new Error('小T没有返回可用的表格行列数据');
  }
  const title =
    typeof args.title === 'string' && args.title.trim()
      ? args.title.trim()
      : fallbackTitle;
  const artifact: DesktopArtifact = {
    id: `spreadsheet-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'spreadsheet',
    title,
    summary: `${sheets.length} 个工作表 · 可预览和导出 XLSX`,
    sheets,
    formats: ['xlsx'],
    createdAt: new Date().toISOString(),
  };
  openDesktopArtifact(artifact);
  return artifact;
};
