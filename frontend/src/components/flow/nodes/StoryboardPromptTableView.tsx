import React from 'react';
import type { StoryboardPromptTableData } from '../types';
import { useLocaleText } from '@/utils/localeText';

type Props = {
  table: StoryboardPromptTableData;
  editable: boolean;
  dark: boolean;
  onChange: (table: StoryboardPromptTableData) => void;
  onWheelCapture: (event: React.WheelEvent<HTMLDivElement>) => void;
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

function StoryboardPromptTableView({
  table,
  editable,
  dark,
  onChange,
  onWheelCapture,
}: Props) {
  const { lt } = useLocaleText();
  const borderColor = dark ? '#3a3a3a' : '#e5e7eb';
  const headerBackground = dark ? '#252525' : '#f8fafc';
  const cellBackground = dark ? '#171717' : '#fff';
  const stickyBackground = dark ? '#202020' : '#f8fafc';
  const textColor = dark ? '#e5e7eb' : '#1f2937';
  const mutedColor = dark ? '#a3a3a3' : '#64748b';
  const overviewEntries = Object.entries(table.overview);

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
    const sourceShotNumber = sourceRow?.values['镜号'] || '';
    onChange({
      ...table,
      rows: table.rows.map((row, index) => {
        const shouldUpdate =
          index === rowIndex ||
          (
            column?.scope === 'shot' &&
            Boolean(sourceShotNumber) &&
            row.values['镜号'] === sourceShotNumber
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

  return (
    <div
      className={editable ? 'nodrag nopan nowheel' : undefined}
      onWheelCapture={onWheelCapture}
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

      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          scrollbarWidth: 'thin',
          background: cellBackground,
        }}
      >
        <table
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
                return (
                  <th
                    key={column.key}
                    title={column.scope === 'shot' ? '镜头字段' : '时序字段'}
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
                      background: columnIndex === 0 ? stickyBackground : headerBackground,
                      color: textColor,
                      fontWeight: 600,
                      whiteSpace: 'normal',
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
                  return (
                    <td
                      key={column.key}
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
                        background: columnIndex === 0 ? stickyBackground : cellBackground,
                      }}
                    >
                      <textarea
                        value={row.values[column.key] || ''}
                        readOnly={!editable}
                        tabIndex={editable ? 0 : -1}
                        onChange={(event) => (
                          updateCell(rowIndex, column.key, event.target.value)
                        )}
                        style={{
                          boxSizing: 'border-box',
                          display: 'block',
                          width: '100%',
                          height: '100%',
                          minHeight: 76,
                          resize: 'none',
                          overflow: 'auto',
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
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default React.memo(StoryboardPromptTableView);
