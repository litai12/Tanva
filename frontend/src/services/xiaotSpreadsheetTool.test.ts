import assert from 'node:assert/strict';
import test from 'node:test';
import { unzipSync } from 'fflate';
import { normalizeSpreadsheetSheets } from './xiaotSpreadsheetTool.ts';
import { buildSpreadsheetWorkbook } from '../desktop/artifacts/spreadsheetExport.ts';

test('normalizes structured spreadsheet rows and columns', () => {
  assert.deepEqual(
    normalizeSpreadsheetSheets([
      { name: '预算', columns: ['项目', '金额'], rows: [['设计', 1200], ['制作', 800]] },
    ]),
    [{ name: '预算', rows: [['项目', '金额'], ['设计', '1200'], ['制作', '800']] }]
  );
});

test('builds a real XLSX package with workbook and worksheet parts', () => {
  const archive = unzipSync(
    buildSpreadsheetWorkbook([{ name: '数据', rows: [['名称', '值'], ['A', '1']] }])
  );
  assert.ok(archive['[Content_Types].xml']);
  assert.ok(archive['xl/workbook.xml']);
  assert.ok(archive['xl/worksheets/sheet1.xml']);
});
