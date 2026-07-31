import {
  strFromU8,
  strToU8,
  unzipSync,
  zipSync,
} from 'fflate';
import type {
  StoryboardPromptColumn,
  StoryboardPromptRow,
  StoryboardPromptTableData,
} from './types';

const XLSX_MIME =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MAX_WORKBOOK_BYTES = 8 * 1024 * 1024;
const STORYBOARD_SHEET_NAME = '分镜表';
const OVERVIEW_SHEET_NAME = '镜头总览';
const COLUMN_SETTINGS_SHEET_NAME = '列设置';

type ParsedWorksheet = {
  name: string;
  rows: string[][];
};

const escapeXml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const decodeXml = (value: string): string =>
  value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#([0-9]+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');

const columnName = (zeroBasedIndex: number): string => {
  let current = zeroBasedIndex + 1;
  let name = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    current = Math.floor((current - 1) / 26);
  }
  return name;
};

const columnIndexFromReference = (reference: string): number => {
  const letters = /^([A-Z]+)/i.exec(reference)?.[1]?.toUpperCase() || 'A';
  let index = 0;
  for (const letter of letters) {
    index = index * 26 + (letter.charCodeAt(0) - 64);
  }
  return Math.max(0, index - 1);
};

const buildCellXml = (
  value: string,
  rowIndex: number,
  columnIndex: number,
  styleIndex: number,
): string => {
  const reference = `${columnName(columnIndex)}${rowIndex + 1}`;
  return `<c r="${reference}" t="inlineStr" s="${styleIndex}"><is><t xml:space="preserve">${escapeXml(
    value,
  )}</t></is></c>`;
};

const buildWorksheetXml = (
  rows: string[][],
  options: {
    freezeHeader?: boolean;
    autoFilter?: boolean;
    columnWidths?: number[];
  } = {},
): string => {
  const maxColumns = Math.max(1, ...rows.map((row) => row.length));
  const rowXml = rows
    .map((row, rowIndex) => {
      const cells = Array.from({ length: maxColumns }, (_, columnIndex) =>
        buildCellXml(
          String(row[columnIndex] ?? ''),
          rowIndex,
          columnIndex,
          rowIndex === 0 ? 1 : 2,
        ),
      ).join('');
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join('');
  const columns = Array.from({ length: maxColumns }, (_, index) => {
    const width = options.columnWidths?.[index] ?? (index === 0 ? 18 : 28);
    return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
  }).join('');
  const lastCell = `${columnName(maxColumns - 1)}${Math.max(1, rows.length)}`;
  const sheetViews = options.freezeHeader
    ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    : '<sheetViews><sheetView workbookViewId="0"/></sheetViews>';
  const autoFilter = options.autoFilter && rows.length > 0
    ? `<autoFilter ref="A1:${lastCell}"/>`
    : '';

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${sheetViews}
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${columns}</cols>
  <sheetData>${rowXml}</sheetData>
  ${autoFilter}
</worksheet>`;
};

const buildStylesXml = (): string => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Arial"/></font>
    <font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Arial"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FF2563EB"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"><color rgb="FFE2E8F0"/></left>
      <right style="thin"><color rgb="FFE2E8F0"/></right>
      <top style="thin"><color rgb="FFE2E8F0"/></top>
      <bottom style="thin"><color rgb="FFE2E8F0"/></bottom>
      <diagonal/>
    </border>
  </borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1">
      <alignment vertical="center" wrapText="1"/>
    </xf>
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1">
      <alignment vertical="top" wrapText="1"/>
    </xf>
  </cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

const createArchiveEntries = (
  table: StoryboardPromptTableData,
): Record<string, Uint8Array> => {
  const storyboardRows = [
    table.columns.map((column) => column.label),
    ...table.rows.map((row) =>
      table.columns.map((column) => String(row.values[column.key] ?? '')),
    ),
  ];
  const overviewRows = [
    ['字段', '值'],
    ...Object.entries(table.overview).map(([label, value]) => [label, value]),
  ];
  const columnSettingRows = [
    ['列名', '作用域', '序号'],
    ...table.columns.map((column, index) => [
      column.label,
      column.scope === 'shot' ? '镜头列' : '时序列',
      String(index + 1),
    ]),
  ];
  const sheetNames = [
    STORYBOARD_SHEET_NAME,
    OVERVIEW_SHEET_NAME,
    COLUMN_SETTINGS_SHEET_NAME,
  ];
  const workbookSheets = sheetNames
    .map(
      (name, index) =>
        `<sheet name="${escapeXml(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    )
    .join('');
  const workbookRelationships = sheetNames
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('');

  const text = (value: string): Uint8Array => strToU8(value);
  return {
    '[Content_Types].xml': text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`),
    '_rels/.rels': text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`),
    'xl/workbook.xml': text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <bookViews><workbookView/></bookViews>
  <sheets>${workbookSheets}</sheets>
</workbook>`),
    'xl/_rels/workbook.xml.rels': text(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationships}
  <Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`),
    'xl/styles.xml': text(buildStylesXml()),
    'xl/worksheets/sheet1.xml': text(
      buildWorksheetXml(storyboardRows, {
        freezeHeader: true,
        autoFilter: true,
        columnWidths: table.columns.map((column) =>
          column.label === '时间段' || column.label === '镜号' ? 18 : 32,
        ),
      }),
    ),
    'xl/worksheets/sheet2.xml': text(
      buildWorksheetXml(overviewRows, {
        freezeHeader: true,
        columnWidths: [24, 36],
      }),
    ),
    'xl/worksheets/sheet3.xml': text(
      buildWorksheetXml(columnSettingRows, {
        freezeHeader: true,
        columnWidths: [30, 18, 12],
      }),
    ),
  };
};

export const buildStoryboardPromptWorkbook = (
  table: StoryboardPromptTableData,
): Uint8Array => zipSync(createArchiveEntries(table), { level: 6 });

const extractAttribute = (attributes: string, name: string): string =>
  decodeXml(
    new RegExp(`(?:^|\\s)${name.replace(':', '\\:')}="([^"]*)"`, 'i')
      .exec(attributes)?.[1] || '',
  );

const extractTextNodes = (xml: string): string => {
  const chunks: string[] = [];
  const textPattern = /<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/gi;
  let match: RegExpExecArray | null;
  while ((match = textPattern.exec(xml))) {
    chunks.push(decodeXml(match[1] || ''));
  }
  return chunks.join('');
};

const parseSharedStrings = (
  archive: Record<string, Uint8Array>,
): string[] => {
  const entry = archive['xl/sharedStrings.xml'];
  if (!entry) return [];
  const xml = strFromU8(entry);
  const strings: string[] = [];
  const itemPattern = /<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gi;
  let match: RegExpExecArray | null;
  while ((match = itemPattern.exec(xml))) {
    strings.push(extractTextNodes(match[1] || ''));
  }
  return strings;
};

const parseWorksheetRows = (
  xml: string,
  sharedStrings: string[],
): string[][] => {
  const rows: string[][] = [];
  const rowPattern = /<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/gi;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowPattern.exec(xml))) {
    const cells: string[] = [];
    const cellPattern =
      /<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gi;
    let cellMatch: RegExpExecArray | null;
    let sequentialColumn = 0;
    while ((cellMatch = cellPattern.exec(rowMatch[1] || ''))) {
      const attributes = cellMatch[1] || '';
      const body = cellMatch[2] || '';
      const reference = extractAttribute(attributes, 'r');
      const columnIndex = reference
        ? columnIndexFromReference(reference)
        : sequentialColumn;
      const type = extractAttribute(attributes, 't');
      const rawValue =
        /<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/i.exec(body)?.[1] || '';
      let value = '';
      if (type === 'inlineStr') {
        value = extractTextNodes(body);
      } else if (type === 's') {
        value = sharedStrings[Number.parseInt(rawValue, 10)] || '';
      } else if (type === 'b') {
        value = rawValue === '1' ? 'TRUE' : 'FALSE';
      } else {
        value = decodeXml(rawValue);
      }
      cells[columnIndex] = value;
      sequentialColumn = columnIndex + 1;
    }
    while (cells.length > 0 && !String(cells[cells.length - 1] ?? '').trim()) {
      cells.pop();
    }
    rows.push(cells);
  }
  return rows;
};

const resolveWorkbookSheets = (
  archive: Record<string, Uint8Array>,
): Array<{ name: string; path: string }> => {
  const workbookEntry = archive['xl/workbook.xml'];
  const relationshipsEntry = archive['xl/_rels/workbook.xml.rels'];
  if (!workbookEntry || !relationshipsEntry) {
    return Object.keys(archive)
      .filter((path) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(path))
      .sort()
      .map((path, index) => ({ name: `Sheet${index + 1}`, path }));
  }

  const relationshipsXml = strFromU8(relationshipsEntry);
  const targetById = new Map<string, string>();
  const relationshipPattern = /<(?:\w+:)?Relationship\b([^>]*)\/?>/gi;
  let relationshipMatch: RegExpExecArray | null;
  while ((relationshipMatch = relationshipPattern.exec(relationshipsXml))) {
    const attributes = relationshipMatch[1] || '';
    const id = extractAttribute(attributes, 'Id');
    const target = extractAttribute(attributes, 'Target');
    if (!id || !target) continue;
    const normalizedTarget = target.startsWith('/')
      ? target.slice(1)
      : target.startsWith('xl/')
        ? target
        : `xl/${target.replace(/^\.\//, '')}`;
    targetById.set(id, normalizedTarget);
  }

  const workbookXml = strFromU8(workbookEntry);
  const sheets: Array<{ name: string; path: string }> = [];
  const sheetPattern = /<(?:\w+:)?sheet\b([^>]*)\/?>/gi;
  let sheetMatch: RegExpExecArray | null;
  while ((sheetMatch = sheetPattern.exec(workbookXml))) {
    const attributes = sheetMatch[1] || '';
    const name = extractAttribute(attributes, 'name');
    const relationshipId =
      extractAttribute(attributes, 'r:id') ||
      extractAttribute(attributes, 'id');
    const path = targetById.get(relationshipId);
    if (name && path && archive[path]) sheets.push({ name, path });
  }
  return sheets;
};

const parseWorkbook = (bytes: Uint8Array): ParsedWorksheet[] => {
  if (bytes.byteLength > MAX_WORKBOOK_BYTES) {
    throw new Error('Excel 文件不能超过 8MB');
  }
  const archive = unzipSync(bytes);
  const sharedStrings = parseSharedStrings(archive);
  return resolveWorkbookSheets(archive).map(({ name, path }) => ({
    name,
    rows: parseWorksheetRows(strFromU8(archive[path]), sharedStrings),
  }));
};

const uniqueColumnLabel = (
  rawLabel: string,
  index: number,
  usedLabels: Set<string>,
): string => {
  const base = rawLabel.trim() || `列 ${index + 1}`;
  let label = base;
  let suffix = 2;
  while (usedLabels.has(label)) {
    label = `${base} (${suffix})`;
    suffix += 1;
  }
  usedLabels.add(label);
  return label;
};

const createImportedId = (prefix: string, index: number): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
};

const inferColumnScope = (
  label: string,
  columnIndex: number,
  dataRows: string[][],
  shotKeys: string[],
): StoryboardPromptColumn['scope'] => {
  if (
    label === '时间段' ||
    label === '目标人物' ||
    label.includes('面部肌肉') ||
    label.includes('肢体动作') ||
    /time\s*(range|segment)|character|facial|action/i.test(label)
  ) {
    return 'timeline';
  }

  const valuesByShot = new Map<string, Set<string>>();
  dataRows.forEach((row, rowIndex) => {
    const value = String(row[columnIndex] ?? '').trim();
    if (!value) return;
    const shotKey = shotKeys[rowIndex] || `row:${rowIndex}`;
    const values = valuesByShot.get(shotKey) || new Set<string>();
    values.add(value);
    valuesByShot.set(shotKey, values);
  });
  return Array.from(valuesByShot.values()).some((values) => values.size > 1)
    ? 'timeline'
    : 'shot';
};

export const parseStoryboardPromptWorkbook = (
  bytes: Uint8Array,
): StoryboardPromptTableData => {
  const worksheets = parseWorkbook(bytes);
  const storyboardSheet =
    worksheets.find((sheet) => sheet.name === STORYBOARD_SHEET_NAME) ||
    worksheets.find((sheet) => /storyboard|分镜/i.test(sheet.name)) ||
    worksheets[0];
  if (!storyboardSheet || storyboardSheet.rows.length === 0) {
    throw new Error('Excel 中没有可用的分镜表');
  }

  const headerRow = storyboardSheet.rows.find((row) =>
    row.some((value) => String(value ?? '').trim()),
  );
  if (!headerRow) throw new Error('分镜表缺少表头');
  const headerIndex = storyboardSheet.rows.indexOf(headerRow);
  const usedLabels = new Set<string>();
  const labels = headerRow.map((value, index) =>
    uniqueColumnLabel(String(value ?? ''), index, usedLabels),
  );
  if (labels.length === 0) throw new Error('分镜表至少需要一列');

  const dataRows = storyboardSheet.rows
    .slice(headerIndex + 1)
    .map((row) => labels.map((_, index) => String(row[index] ?? '')))
    .filter((row) => row.some((value) => value.trim()));
  const shotNumberIndex = labels.findIndex(
    (label) =>
      label === '镜号' ||
      /^(shot|镜头).*(number|no\.?|编号|号)$/i.test(label),
  );
  const shotKeys: string[] = [];
  let previousShotKey = '';
  dataRows.forEach((row, rowIndex) => {
    const explicitShot =
      shotNumberIndex >= 0 ? String(row[shotNumberIndex] ?? '').trim() : '';
    if (explicitShot) previousShotKey = `shot:${explicitShot}`;
    if (!previousShotKey || shotNumberIndex < 0) {
      previousShotKey = `row:${rowIndex + 1}`;
    }
    shotKeys.push(previousShotKey);
  });

  const columnSettingsSheet = worksheets.find(
    (sheet) => sheet.name === COLUMN_SETTINGS_SHEET_NAME,
  );
  const scopeByLabel = new Map<string, StoryboardPromptColumn['scope']>();
  columnSettingsSheet?.rows.slice(1).forEach((row) => {
    const label = String(row[0] ?? '').trim();
    const rawScope = String(row[1] ?? '').trim();
    if (!label) return;
    scopeByLabel.set(
      label,
      rawScope === '镜头列' || rawScope.toLowerCase() === 'shot'
        ? 'shot'
        : 'timeline',
    );
  });

  const columns: StoryboardPromptColumn[] = labels.map((label, index) => ({
    key: `excel-column-${index + 1}-${createImportedId('key', index)}`,
    label,
    scope:
      scopeByLabel.get(label) ||
      inferColumnScope(label, index, dataRows, shotKeys),
  }));
  const shotIdByKey = new Map<string, string>();
  const rows: StoryboardPromptRow[] = dataRows.map((row, rowIndex) => {
    const shotKey = shotKeys[rowIndex] || `row:${rowIndex + 1}`;
    let shotId = shotIdByKey.get(shotKey);
    if (!shotId) {
      shotId = createImportedId('storyboard-shot', shotIdByKey.size);
      shotIdByKey.set(shotKey, shotId);
    }
    const values: Record<string, string> = {};
    columns.forEach((column, columnIndex) => {
      values[column.key] = row[columnIndex] || '';
    });
    return {
      id: createImportedId('storyboard-row', rowIndex),
      shotId,
      values,
    };
  });

  const overview: Record<string, string> = {};
  const overviewSheet = worksheets.find(
    (sheet) => sheet.name === OVERVIEW_SHEET_NAME,
  );
  overviewSheet?.rows.slice(1).forEach((row) => {
    const label = String(row[0] ?? '').trim();
    if (label) overview[label] = String(row[1] ?? '');
  });
  overview['总镜数'] = String(new Set(rows.map((row) => row.shotId)).size);
  if (!('素材总时长' in overview)) overview['素材总时长'] = '';

  return {
    version: 1,
    overview,
    columns,
    rows,
  };
};

export const downloadStoryboardPromptWorkbook = (
  table: StoryboardPromptTableData,
  rawFileName = '分镜表',
): void => {
  const bytes = buildStoryboardPromptWorkbook(table);
  const blob = new Blob([bytes.buffer as ArrayBuffer], { type: XLSX_MIME });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const safeName =
    rawFileName.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\.xlsx$/i, '') ||
    '分镜表';
  link.href = url;
  link.download = `${safeName}.xlsx`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
};
