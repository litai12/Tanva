import React from 'react';
import type { StoryboardPromptTableData } from '../types';
import { useLocaleText } from '@/utils/localeText';
import {
  downloadStoryboardPromptWorkbook,
  parseStoryboardPromptWorkbook,
} from '../storyboardPromptExcel';

export type StoryboardCellInputContext = {
  rowIndex: number;
  columnKey: string;
  value: string;
  selectionStart: number;
  selectionEnd: number;
  element: HTMLTextAreaElement;
};

export type StoryboardPromptTableViewHandle = {
  focusToken: (token: string) => boolean;
};

type Props = {
  table: StoryboardPromptTableData;
  editable: boolean;
  dark: boolean;
  onChange: (table: StoryboardPromptTableData) => void;
  onWheelCapture: (event: React.WheelEvent<HTMLDivElement>) => void;
  onCellInput?: (context: StoryboardCellInputContext) => void;
  onCellSelect?: (context: StoryboardCellInputContext) => void;
  onCellKeyDown?: (
    event: React.KeyboardEvent<HTMLTextAreaElement>,
    context: StoryboardCellInputContext,
  ) => void;
};

const getColumnWidth = (label: string): number => {
  if (label === '时间段' || label === '镜号' || label === '景别') return 128;
  if (label === '目标人物' || label === '机位运动' || label === '构图方式') return 150;
  if (
    label.includes('画面整体内容') ||
    label.includes('面部肌肉') ||
    label.includes('肢体动作')
  ) {
    return 240;
  }
  return 180;
};

const createStoryboardRowId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `storyboard-row-${crypto.randomUUID()}`;
  }
  return `storyboard-row-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createStoryboardShotId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `storyboard-shot-${crypto.randomUUID()}`;
  }
  return `storyboard-shot-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const createStoryboardColumnKey = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `storyboard-column-${crypto.randomUUID()}`;
  }
  return `storyboard-column-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const getColumnKeyByLabel = (
  table: StoryboardPromptTableData,
  label: string,
): string | undefined =>
  table.columns.find((column) => column.label === label)?.key ||
  table.columns.find((column) => column.key === label)?.key;

const synchronizeShotCount = (
  table: StoryboardPromptTableData,
): StoryboardPromptTableData => ({
  ...table,
  overview: {
    ...table.overview,
    总镜数: String(new Set(table.rows.map((row) => row.shotId)).size),
  },
});

const getNextShotNumber = (table: StoryboardPromptTableData): string => {
  const shotNumberKey = getColumnKeyByLabel(table, '镜号');
  if (!shotNumberKey) return 'M001';
  const highest = table.rows.reduce((max, row) => {
    const match = /^M(\d+)$/i.exec(
      String(row.values[shotNumberKey] || '').trim(),
    );
    if (!match) return max;
    return Math.max(max, Number(match[1]) || 0);
  }, 0);
  return `M${String(highest + 1).padStart(3, '0')}`;
};

const getCellRefKey = (rowId: string, columnKey: string): string =>
  `${rowId}::${columnKey}`;

const StoryboardPromptTableView = React.forwardRef<
  StoryboardPromptTableViewHandle,
  Props
>(function StoryboardPromptTableView({
  table,
  editable,
  dark,
  onChange,
  onWheelCapture,
  onCellInput,
  onCellSelect,
  onCellKeyDown,
}, forwardedRef) {
  const { lt } = useLocaleText();
  const borderColor = dark ? '#3a3a3a' : '#e5e7eb';
  const headerBackground = dark ? '#252525' : '#f8fafc';
  const cellBackground = dark ? '#171717' : '#fff';
  const stickyBackground = dark ? '#202020' : '#f8fafc';
  const textColor = dark ? '#e5e7eb' : '#1f2937';
  const mutedColor = dark ? '#a3a3a3' : '#64748b';
  const selectedBackground = dark ? '#172554' : '#eff6ff';
  const selectedBorder = dark ? '#60a5fa' : '#2563eb';
  const toolbarBackground = dark ? '#1d1d1d' : '#fff';
  const overviewEntries = Object.entries(table.overview);
  const [selectedRowIndex, setSelectedRowIndex] = React.useState<number | null>(
    table.rows.length > 0 ? 0 : null,
  );
  const [selectedColumnKey, setSelectedColumnKey] = React.useState<string | null>(
    table.columns[0]?.key || null,
  );
  const scrollViewportRef = React.useRef<HTMLDivElement>(null);
  const tableElementRef = React.useRef<HTMLTableElement>(null);
  const importInputRef = React.useRef<HTMLInputElement>(null);
  const cellRefs = React.useRef(new Map<string, HTMLTextAreaElement>());
  const [isImporting, setIsImporting] = React.useState(false);
  const [horizontalScroll, setHorizontalScroll] = React.useState({
    left: 0,
    max: 0,
  });
  const selectedColumn = table.columns.find(
    (column) => column.key === selectedColumnKey,
  );
  const hasSelectedRow =
    selectedRowIndex !== null &&
    selectedRowIndex >= 0 &&
    selectedRowIndex < table.rows.length;

  const showToast = React.useCallback((
    message: string,
    type: 'success' | 'warning' | 'error' = 'warning',
  ) => {
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { message, type },
    }));
  }, []);

  const updateScrollMetrics = React.useCallback(() => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    const max = Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    setHorizontalScroll((current) => {
      const left = Math.max(0, Math.min(viewport.scrollLeft, max));
      return current.left === left && current.max === max
        ? current
        : { left, max };
    });
  }, []);

  React.useLayoutEffect(() => {
    updateScrollMetrics();
    const viewport = scrollViewportRef.current;
    const tableElement = tableElementRef.current;
    if (typeof ResizeObserver === 'undefined' || !viewport || !tableElement) {
      return undefined;
    }
    const observer = new ResizeObserver(updateScrollMetrics);
    observer.observe(viewport);
    observer.observe(tableElement);
    return () => observer.disconnect();
  }, [table.columns, table.rows.length, updateScrollMetrics]);

  React.useImperativeHandle(forwardedRef, () => ({
    focusToken: (token: string): boolean => {
      if (!token) return false;
      for (const row of table.rows) {
        for (const column of table.columns) {
          const value = String(row.values[column.key] || '');
          const tokenIndex = value.indexOf(token);
          if (tokenIndex < 0) continue;
          const textarea = cellRefs.current.get(
            getCellRefKey(row.id, column.key),
          );
          if (!textarea) return false;
          textarea.scrollIntoView({ block: 'nearest', inline: 'nearest' });
          requestAnimationFrame(() => {
            textarea.focus();
            textarea.setSelectionRange(
              tokenIndex,
              tokenIndex + token.length,
            );
          });
          return true;
        }
      }
      return false;
    },
  }), [table.columns, table.rows]);

  React.useEffect(() => {
    setSelectedRowIndex((current) => {
      if (table.rows.length === 0) return null;
      if (current === null) return 0;
      return Math.min(current, table.rows.length - 1);
    });
  }, [table.rows.length]);

  React.useEffect(() => {
    if (
      selectedColumnKey &&
      table.columns.some((column) => column.key === selectedColumnKey)
    ) {
      return;
    }
    setSelectedColumnKey(table.columns[0]?.key || null);
  }, [selectedColumnKey, table.columns]);

  const showStructureWarning = (message: string) => {
    showToast(message, 'warning');
  };

  const addRow = (mode: 'timeline' | 'shot') => {
    const referenceIndex = hasSelectedRow
      ? selectedRowIndex
      : table.rows.length - 1;
    const referenceRow = referenceIndex !== null && referenceIndex >= 0
      ? table.rows[referenceIndex]
      : undefined;
    const values: Record<string, string> = {};
    table.columns.forEach((column) => {
      values[column.key] =
        mode === 'timeline' && column.scope === 'shot' && referenceRow
          ? referenceRow.values[column.key] || ''
          : '';
    });
    const shotNumberKey = getColumnKeyByLabel(table, '镜号');
    if (shotNumberKey && (mode === 'shot' || !referenceRow)) {
      values[shotNumberKey] = getNextShotNumber(table);
    }

    const shotEndIndex =
      mode === 'shot' && referenceRow
        ? table.rows.reduce(
            (lastIndex, row, index) => (
              row.shotId === referenceRow.shotId ? index : lastIndex
            ),
            referenceIndex ?? -1,
          )
        : referenceIndex;
    const insertAt = shotEndIndex !== null && shotEndIndex >= 0
      ? shotEndIndex + 1
      : table.rows.length;
    const nextRows = table.rows.slice();
    nextRows.splice(insertAt, 0, {
      id: createStoryboardRowId(),
      shotId:
        mode === 'timeline' && referenceRow
          ? referenceRow.shotId
          : createStoryboardShotId(),
      values,
    });
    setSelectedRowIndex(insertAt);
    onChange(synchronizeShotCount({ ...table, rows: nextRows }));
  };

  const duplicateSelectedRow = () => {
    if (!hasSelectedRow || selectedRowIndex === null) return;
    const source = table.rows[selectedRowIndex];
    const nextRows = table.rows.slice();
    nextRows.splice(selectedRowIndex + 1, 0, {
      id: createStoryboardRowId(),
      shotId: source.shotId,
      values: { ...source.values },
    });
    setSelectedRowIndex(selectedRowIndex + 1);
    onChange(synchronizeShotCount({ ...table, rows: nextRows }));
  };

  const deleteSelectedRow = () => {
    if (!hasSelectedRow || selectedRowIndex === null) return;
    const nextRows = table.rows.filter((_, index) => index !== selectedRowIndex);
    setSelectedRowIndex(
      nextRows.length > 0 ? Math.min(selectedRowIndex, nextRows.length - 1) : null,
    );
    onChange(synchronizeShotCount({ ...table, rows: nextRows }));
  };

  const addColumn = () => {
    const defaultLabel = lt(
      `新列 ${table.columns.length + 1}`,
      `Column ${table.columns.length + 1}`,
    );
    const rawLabel = window.prompt(
      lt('输入新列名称', 'Enter a new column name'),
      defaultLabel,
    );
    if (rawLabel === null) return;
    const label = rawLabel.trim();
    if (!label) {
      showStructureWarning(lt('列名不能为空', 'Column name cannot be empty'));
      return;
    }
    if (table.columns.some((column) => column.label === label)) {
      showStructureWarning(lt('列名不能重复', 'Column names must be unique'));
      return;
    }
    const key = createStoryboardColumnKey();
    const insertAfter = selectedColumnKey
      ? table.columns.findIndex((column) => column.key === selectedColumnKey)
      : table.columns.length - 1;
    const nextColumns = table.columns.slice();
    nextColumns.splice(insertAfter + 1, 0, {
      key,
      label,
      scope: 'timeline',
    });
    setSelectedColumnKey(key);
    onChange({
      ...table,
      columns: nextColumns,
      rows: table.rows.map((row) => ({
        ...row,
        values: { ...row.values, [key]: '' },
      })),
    });
  };

  const renameSelectedColumn = () => {
    if (!selectedColumn) return;
    const rawLabel = window.prompt(
      lt('修改列名', 'Rename column'),
      selectedColumn.label,
    );
    if (rawLabel === null) return;
    const label = rawLabel.trim();
    if (!label) {
      showStructureWarning(lt('列名不能为空', 'Column name cannot be empty'));
      return;
    }
    if (
      table.columns.some(
        (column) => column.key !== selectedColumn.key && column.label === label,
      )
    ) {
      showStructureWarning(lt('列名不能重复', 'Column names must be unique'));
      return;
    }
    onChange({
      ...table,
      columns: table.columns.map((column) => (
        column.key === selectedColumn.key ? { ...column, label } : column
      )),
    });
  };

  const toggleSelectedColumnScope = () => {
    if (!selectedColumn) return;
    const nextScope = selectedColumn.scope === 'shot' ? 'timeline' : 'shot';
    let nextRows = table.rows;
    if (nextScope === 'shot' && hasSelectedRow && selectedRowIndex !== null) {
      const sourceRow = table.rows[selectedRowIndex];
      const sourceValue = sourceRow.values[selectedColumn.key] || '';
      if (sourceRow.shotId) {
        nextRows = table.rows.map((row) => (
          row.shotId === sourceRow.shotId
            ? {
                ...row,
                values: { ...row.values, [selectedColumn.key]: sourceValue },
              }
            : row
        ));
      }
    }
    onChange({
      ...table,
      columns: table.columns.map((column) => (
        column.key === selectedColumn.key
          ? { ...column, scope: nextScope }
          : column
      )),
      rows: nextRows,
    });
  };

  const deleteSelectedColumn = () => {
    if (!selectedColumn) return;
    if (table.columns.length <= 1) {
      showStructureWarning(lt('至少保留一列', 'Keep at least one column'));
      return;
    }
    const columnIndex = table.columns.findIndex(
      (column) => column.key === selectedColumn.key,
    );
    const nextColumns = table.columns.filter(
      (column) => column.key !== selectedColumn.key,
    );
    const nextSelectedColumn =
      nextColumns[Math.min(columnIndex, nextColumns.length - 1)]?.key || null;
    setSelectedColumnKey(nextSelectedColumn);
    onChange({
      ...table,
      columns: nextColumns,
      rows: table.rows.map((row) => {
        const values = { ...row.values };
        delete values[selectedColumn.key];
        return { ...row, values };
      }),
    });
  };

  const structureButtonStyle = (
    disabled = false,
    destructive = false,
  ): React.CSSProperties => ({
    flex: '0 0 auto',
    height: 24,
    padding: '0 7px',
    border: `1px solid ${borderColor}`,
    borderRadius: 5,
    background: disabled
      ? (dark ? '#222' : '#f8fafc')
      : (dark ? '#2a2a2a' : '#fff'),
    color: disabled
      ? mutedColor
      : destructive
        ? (dark ? '#fca5a5' : '#dc2626')
        : textColor,
    fontSize: 10,
    lineHeight: '22px',
    whiteSpace: 'nowrap',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.55 : 1,
  });

  const updateOverview = React.useCallback((label: string, value: string) => {
    onChange({
      ...table,
      overview: {
        ...table.overview,
        [label]: value,
      },
    });
  }, [onChange, table]);

  const updateCell = React.useCallback((
    rowIndex: number,
    columnKey: string,
    value: string,
  ) => {
    const column = table.columns.find((candidate) => candidate.key === columnKey);
    const sourceRow = table.rows[rowIndex];
    const sourceShotId = sourceRow?.shotId || '';
    onChange({
      ...table,
      rows: table.rows.map((row, index) => {
        const shouldUpdate =
          index === rowIndex ||
          (
            column?.scope === 'shot' &&
            Boolean(sourceShotId) &&
            row.shotId === sourceShotId
          );
        return shouldUpdate
          ? {
              ...row,
              values: {
                ...row.values,
                [columnKey]: value,
              },
            }
          : row;
      }),
    });
  }, [onChange, table]);

  const getCellInputContext = React.useCallback((
    element: HTMLTextAreaElement,
    rowIndex: number,
    columnKey: string,
  ): StoryboardCellInputContext => ({
    rowIndex,
    columnKey,
    value: element.value,
    selectionStart: element.selectionStart ?? element.value.length,
    selectionEnd: element.selectionEnd ?? element.value.length,
    element,
  }), []);

  const openAssetMentionPicker = React.useCallback(() => {
    if (
      !hasSelectedRow ||
      selectedRowIndex === null ||
      !selectedColumnKey
    ) {
      showToast(
        lt('请先选择一个表格单元格', 'Select a table cell first'),
        'warning',
      );
      return;
    }
    const row = table.rows[selectedRowIndex];
    if (!row) return;
    const textarea = cellRefs.current.get(
      getCellRefKey(row.id, selectedColumnKey),
    );
    if (!textarea) return;

    textarea.focus();
    const selectionStart = textarea.selectionStart ?? textarea.value.length;
    const selectionEnd = textarea.selectionEnd ?? selectionStart;
    textarea.setRangeText('@', selectionStart, selectionEnd, 'end');
    updateCell(selectedRowIndex, selectedColumnKey, textarea.value);
    onCellInput?.(
      getCellInputContext(
        textarea,
        selectedRowIndex,
        selectedColumnKey,
      ),
    );
  }, [
    getCellInputContext,
    hasSelectedRow,
    lt,
    onCellInput,
    selectedColumnKey,
    selectedRowIndex,
    showToast,
    table.rows,
    updateCell,
  ]);

  const scrollHorizontally = React.useCallback((distance: number) => {
    const viewport = scrollViewportRef.current;
    if (!viewport) return;
    viewport.scrollBy({ left: distance, behavior: 'smooth' });
  }, []);

  const handleTableWheelCapture = React.useCallback((
    event: React.WheelEvent<HTMLDivElement>,
  ) => {
    onWheelCapture(event);
    if (!event.isPropagationStopped()) return;

    const viewport = scrollViewportRef.current;
    if (!viewport || horizontalScroll.max <= 0) return;
    const horizontalDelta =
      event.shiftKey && Math.abs(event.deltaY) >= Math.abs(event.deltaX)
        ? event.deltaY
        : event.deltaX;
    if (Math.abs(horizontalDelta) < 0.5) return;
    viewport.scrollLeft += horizontalDelta;
    event.preventDefault();
    updateScrollMetrics();
  }, [horizontalScroll.max, onWheelCapture, updateScrollMetrics]);

  const handleExportExcel = React.useCallback(() => {
    try {
      const date = new Date().toISOString().slice(0, 10);
      downloadStoryboardPromptWorkbook(table, `分镜表-${date}`);
      showToast(lt('Excel 已导出', 'Excel exported'), 'success');
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : lt('Excel 导出失败', 'Failed to export Excel'),
        'error',
      );
    }
  }, [lt, showToast, table]);

  const handleImportExcel = React.useCallback(async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      showToast(
        lt('请选择 .xlsx 格式的 Excel 文件', 'Choose an .xlsx Excel file'),
        'warning',
      );
      return;
    }

    setIsImporting(true);
    try {
      const nextTable = parseStoryboardPromptWorkbook(
        new Uint8Array(await file.arrayBuffer()),
      );
      setSelectedRowIndex(nextTable.rows.length > 0 ? 0 : null);
      setSelectedColumnKey(nextTable.columns[0]?.key || null);
      onChange(nextTable);
      showToast(
        lt(
          `已导入 ${nextTable.rows.length} 行、${nextTable.columns.length} 列`,
          `Imported ${nextTable.rows.length} rows and ${nextTable.columns.length} columns`,
        ),
        'success',
      );
      requestAnimationFrame(updateScrollMetrics);
    } catch (error) {
      showToast(
        error instanceof Error
          ? error.message
          : lt('Excel 导入失败', 'Failed to import Excel'),
        'error',
      );
    } finally {
      setIsImporting(false);
    }
  }, [lt, onChange, showToast, updateScrollMetrics]);

  return (
    <div
      className={editable ? 'nodrag nopan nowheel' : undefined}
      onWheelCapture={handleTableWheelCapture}
      onPointerDownCapture={(event) => {
        if (editable) event.stopPropagation();
      }}
      onMouseDownCapture={(event) => {
        if (editable) event.stopPropagation();
      }}
      style={{
        width: '100%',
        height: '100%',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        color: textColor,
      }}
    >
      <div
        style={{
          flex: '0 0 auto',
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minHeight: 34,
          padding: '5px 8px',
          overflowX: 'auto',
          borderBottom: `1px solid ${borderColor}`,
          background: headerBackground,
          scrollbarWidth: 'thin',
        }}
      >
        {overviewEntries.length > 0 ? overviewEntries.map(([label, value]) => (
          <label
            key={label}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 5,
              flex: '0 0 auto',
              fontSize: 11,
              color: mutedColor,
              whiteSpace: 'nowrap',
            }}
          >
            <span>{label}</span>
            <input
              value={value}
              readOnly={!editable}
              tabIndex={editable ? 0 : -1}
              onChange={(event) => updateOverview(label, event.target.value)}
              style={{
                width: label.includes('时长') ? 90 : 62,
                height: 23,
                border: `1px solid ${borderColor}`,
                borderRadius: 4,
                padding: '2px 5px',
                outline: 'none',
                background: cellBackground,
                color: textColor,
                fontSize: 11,
                pointerEvents: editable ? 'auto' : 'none',
              }}
            />
          </label>
        )) : (
          <span style={{ fontSize: 11, color: mutedColor }}>
            {lt('暂无镜头总览', 'No shot overview')}
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            flex: '0 0 auto',
            fontSize: 10,
            color: mutedColor,
          }}
        >
          {lt(
            `${table.rows.length} 行 · ${table.columns.length} 列`,
            `${table.rows.length} rows · ${table.columns.length} columns`,
          )}
        </span>
      </div>

      {editable && (
        <div
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            minHeight: 34,
            padding: '5px 8px',
            overflowX: 'auto',
            borderBottom: `1px solid ${borderColor}`,
            background: toolbarBackground,
            scrollbarWidth: 'thin',
          }}
        >
          <button
            type="button"
            onClick={() => addRow('timeline')}
            style={structureButtonStyle()}
            title={lt(
              '在选中行后新增同镜头的时序行',
              'Add a timeline row for the same shot after the selection',
            )}
          >
            {lt('+ 时序行', '+ Timeline row')}
          </button>
          <button
            type="button"
            onClick={() => addRow('shot')}
            style={structureButtonStyle()}
            title={lt(
              '在选中行后新增一个镜头',
              'Add a new shot after the selection',
            )}
          >
            {lt('+ 镜头', '+ Shot')}
          </button>
          <button
            type="button"
            disabled={!hasSelectedRow}
            onClick={duplicateSelectedRow}
            style={structureButtonStyle(!hasSelectedRow)}
          >
            {lt('复制行', 'Duplicate row')}
          </button>
          <button
            type="button"
            disabled={!hasSelectedRow}
            onClick={deleteSelectedRow}
            style={structureButtonStyle(!hasSelectedRow, true)}
          >
            {lt('删除行', 'Delete row')}
          </button>

          <span
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              width: 1,
              height: 18,
              margin: '0 2px',
              background: borderColor,
            }}
          />

          <button
            type="button"
            onClick={addColumn}
            style={structureButtonStyle()}
          >
            {lt('+ 列', '+ Column')}
          </button>
          <button
            type="button"
            disabled={!selectedColumn}
            onClick={renameSelectedColumn}
            style={structureButtonStyle(!selectedColumn)}
          >
            {lt('重命名', 'Rename')}
          </button>
          <button
            type="button"
            disabled={!selectedColumn}
            onClick={toggleSelectedColumnScope}
            style={structureButtonStyle(!selectedColumn)}
            title={lt(
              '镜头字段会联动当前镜号的所有时间行；时序字段只修改当前行',
              'Shot fields sync across the current shot; timeline fields edit one row',
            )}
          >
            {selectedColumn?.scope === 'shot'
              ? lt('镜头列', 'Shot column')
              : lt('时序列', 'Timeline column')}
          </button>
          <button
            type="button"
            disabled={!selectedColumn || table.columns.length <= 1}
            onClick={deleteSelectedColumn}
            style={structureButtonStyle(
              !selectedColumn || table.columns.length <= 1,
              true,
            )}
          >
            {lt('删除列', 'Delete column')}
          </button>
          <button
            type="button"
            disabled={!hasSelectedRow || !selectedColumn}
            onClick={openAssetMentionPicker}
            style={structureButtonStyle(!hasSelectedRow || !selectedColumn)}
            title={lt(
              '在当前单元格插入 @ 并选择工作流、项目库或个人库资产',
              'Insert @ in the active cell and choose a workflow, project, or personal asset',
            )}
          >
            {lt('@ 资产', '@ Asset')}
          </button>

          <span
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              width: 1,
              height: 18,
              margin: '0 2px',
              background: borderColor,
            }}
          />

          <button
            type="button"
            disabled={isImporting}
            onClick={() => importInputRef.current?.click()}
            style={structureButtonStyle(isImporting)}
            title={lt(
              '从 .xlsx 导入动态列、镜头总览和时序行',
              'Import dynamic columns, overview, and timeline rows from .xlsx',
            )}
          >
            {isImporting
              ? lt('导入中…', 'Importing…')
              : lt('导入 Excel', 'Import Excel')}
          </button>
          <button
            type="button"
            onClick={handleExportExcel}
            style={structureButtonStyle()}
            title={lt(
              '导出分镜表、镜头总览和列设置',
              'Export the storyboard, overview, and column settings',
            )}
          >
            {lt('导出 Excel', 'Export Excel')}
          </button>

          <span
            style={{
              marginLeft: 'auto',
              flex: '0 0 auto',
              maxWidth: 220,
              overflow: 'hidden',
              color: mutedColor,
              fontSize: 10,
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={[
              hasSelectedRow && selectedRowIndex !== null
                ? lt(`第 ${selectedRowIndex + 1} 行`, `Row ${selectedRowIndex + 1}`)
                : lt('未选行', 'No row selected'),
              selectedColumn?.label || lt('未选列', 'No column selected'),
            ].join(' · ')}
          >
            {[
              hasSelectedRow && selectedRowIndex !== null
                ? lt(`第 ${selectedRowIndex + 1} 行`, `Row ${selectedRowIndex + 1}`)
                : lt('未选行', 'No row selected'),
              selectedColumn?.label || lt('未选列', 'No column selected'),
            ].join(' · ')}
          </span>
        </div>
      )}

      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        tabIndex={-1}
        aria-hidden="true"
        onChange={handleImportExcel}
        style={{ display: 'none' }}
      />

      {horizontalScroll.max > 1 && (
        <div
          className="nodrag nopan nowheel"
          style={{
            flex: '0 0 auto',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            minHeight: 30,
            padding: '4px 8px',
            borderBottom: `1px solid ${borderColor}`,
            background: toolbarBackground,
          }}
          title={lt(
            '拖动滑块或使用 Shift + 滚轮横向浏览',
            'Drag the slider or use Shift + wheel to scroll horizontally',
          )}
        >
          <span
            style={{
              flex: '0 0 auto',
              color: mutedColor,
              fontSize: 10,
              whiteSpace: 'nowrap',
            }}
          >
            {lt('横向浏览', 'Horizontal')}
          </span>
          <button
            type="button"
            aria-label={lt('向左滚动', 'Scroll left')}
            disabled={horizontalScroll.left <= 0}
            onClick={() =>
              scrollHorizontally(
                -(scrollViewportRef.current?.clientWidth || 320) * 0.7,
              )}
            style={structureButtonStyle(horizontalScroll.left <= 0)}
          >
            ‹
          </button>
          <input
            type="range"
            min={0}
            max={Math.max(1, horizontalScroll.max)}
            step={1}
            value={Math.min(horizontalScroll.left, horizontalScroll.max)}
            aria-label={lt('表格横向滚动位置', 'Horizontal table position')}
            onChange={(event) => {
              const viewport = scrollViewportRef.current;
              if (!viewport) return;
              viewport.scrollLeft = Number(event.target.value);
              updateScrollMetrics();
            }}
            style={{
              flex: 1,
              minWidth: 80,
              height: 16,
              cursor: 'ew-resize',
              accentColor: selectedBorder,
            }}
          />
          <button
            type="button"
            aria-label={lt('向右滚动', 'Scroll right')}
            disabled={horizontalScroll.left >= horizontalScroll.max - 1}
            onClick={() =>
              scrollHorizontally(
                (scrollViewportRef.current?.clientWidth || 320) * 0.7,
              )}
            style={structureButtonStyle(
              horizontalScroll.left >= horizontalScroll.max - 1,
            )}
          >
            ›
          </button>
        </div>
      )}

      <div
        ref={scrollViewportRef}
        onScroll={updateScrollMetrics}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          scrollbarWidth: 'thin',
          scrollbarGutter: 'stable',
          overscrollBehavior: 'contain',
          background: cellBackground,
        }}
      >
        <table
          ref={tableElementRef}
          style={{
            borderCollapse: 'separate',
            borderSpacing: 0,
            minWidth: '100%',
            width: 'max-content',
            tableLayout: 'fixed',
            fontSize: 11,
          }}
        >
          <thead>
            <tr>
              {table.columns.map((column, columnIndex) => {
                const width = getColumnWidth(column.label);
                const isSelectedColumn = column.key === selectedColumnKey;
                return (
                  <th
                    key={column.key}
                    onClick={() => {
                      if (editable) setSelectedColumnKey(column.key);
                    }}
                    title={
                      column.scope === 'shot'
                        ? lt(
                            '镜头字段：修改后同步到同镜号的所有时间行',
                            'Shot field: edits sync across rows in the same shot',
                          )
                        : lt(
                            '时序字段：修改只作用于当前行',
                            'Timeline field: edits apply only to the current row',
                          )
                    }
                    style={{
                      position: 'sticky',
                      top: 0,
                      left: columnIndex === 0 ? 0 : undefined,
                      zIndex: columnIndex === 0 ? 4 : 3,
                      width,
                      minWidth: width,
                      maxWidth: width,
                      height: 34,
                      padding: '6px 8px',
                      textAlign: 'left',
                      verticalAlign: 'middle',
                      borderRight: `1px solid ${borderColor}`,
                      borderBottom: `1px solid ${borderColor}`,
                      background: isSelectedColumn
                        ? selectedBackground
                        : columnIndex === 0
                          ? stickyBackground
                          : headerBackground,
                      color: textColor,
                      fontWeight: 600,
                      whiteSpace: 'normal',
                      cursor: editable ? 'pointer' : 'default',
                      boxShadow: isSelectedColumn
                        ? `inset 0 -2px 0 ${selectedBorder}`
                        : undefined,
                    }}
                  >
                    {column.label}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, rowIndex) => (
              <tr key={row.id}>
                {table.columns.map((column, columnIndex) => {
                  const width = getColumnWidth(column.label);
                  const isSelectedRow = rowIndex === selectedRowIndex;
                  const isSelectedColumn = column.key === selectedColumnKey;
                  const isActiveCell = isSelectedRow && isSelectedColumn;
                  return (
                    <td
                      key={column.key}
                      onClick={() => {
                        if (!editable) return;
                        setSelectedRowIndex(rowIndex);
                        setSelectedColumnKey(column.key);
                      }}
                      style={{
                        position: columnIndex === 0 ? 'sticky' : 'relative',
                        left: columnIndex === 0 ? 0 : undefined,
                        zIndex: columnIndex === 0 ? 2 : 1,
                        width,
                        minWidth: width,
                        maxWidth: width,
                        height: 76,
                        padding: 0,
                        verticalAlign: 'top',
                        borderRight: `1px solid ${borderColor}`,
                        borderBottom: `1px solid ${borderColor}`,
                        background: isActiveCell
                          ? selectedBackground
                          : columnIndex === 0
                            ? stickyBackground
                            : cellBackground,
                        boxShadow: isActiveCell
                          ? `inset 0 0 0 2px ${selectedBorder}`
                          : isSelectedRow
                            ? `inset 0 -1px 0 ${dark ? '#334155' : '#bfdbfe'}`
                            : undefined,
                      }}
                    >
                      <textarea
                        ref={(element) => {
                          const refKey = getCellRefKey(row.id, column.key);
                          if (element) {
                            cellRefs.current.set(refKey, element);
                          } else {
                            cellRefs.current.delete(refKey);
                          }
                        }}
                        value={row.values[column.key] || ''}
                        readOnly={!editable}
                        tabIndex={editable ? 0 : -1}
                        onFocus={(event) => {
                          if (!editable) return;
                          setSelectedRowIndex(rowIndex);
                          setSelectedColumnKey(column.key);
                          onCellSelect?.(
                            getCellInputContext(
                              event.currentTarget,
                              rowIndex,
                              column.key,
                            ),
                          );
                        }}
                        onSelect={(event) => {
                          if (!editable) return;
                          onCellSelect?.(
                            getCellInputContext(
                              event.currentTarget,
                              rowIndex,
                              column.key,
                            ),
                          );
                        }}
                        onKeyDown={(event) => {
                          if (!editable) return;
                          onCellKeyDown?.(
                            event,
                            getCellInputContext(
                              event.currentTarget,
                              rowIndex,
                              column.key,
                            ),
                          );
                        }}
                        onChange={(event) => {
                          const nextValue = event.currentTarget.value;
                          updateCell(rowIndex, column.key, nextValue);
                          onCellInput?.(
                            getCellInputContext(
                              event.currentTarget,
                              rowIndex,
                              column.key,
                            ),
                          );
                        }}
                        style={{
                          boxSizing: 'border-box',
                          display: 'block',
                          width: '100%',
                          height: '100%',
                          minHeight: 76,
                          resize: 'none',
                          overflow: 'auto',
                          scrollbarWidth: 'thin',
                          scrollbarGutter: 'stable',
                          border: 'none',
                          borderRadius: 0,
                          outline: 'none',
                          padding: '7px 8px',
                          background: 'transparent',
                          color: textColor,
                          fontFamily: 'inherit',
                          fontSize: 11,
                          lineHeight: 1.45,
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-word',
                          pointerEvents: editable ? 'auto' : 'none',
                        }}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
            {table.rows.length === 0 && (
              <tr>
                <td
                  colSpan={Math.max(1, table.columns.length)}
                  style={{
                    height: 96,
                    padding: 16,
                    borderBottom: `1px solid ${borderColor}`,
                    background: cellBackground,
                    color: mutedColor,
                    textAlign: 'center',
                  }}
                >
                  {lt(
                    '暂无分镜行，请使用上方“+ 镜头”或“+ 时序行”添加。',
                    'No storyboard rows. Use “+ Shot” or “+ Timeline row” above.',
                  )}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
});

export default React.memo(StoryboardPromptTableView);
