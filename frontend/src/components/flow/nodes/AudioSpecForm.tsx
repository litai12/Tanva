import React from 'react';
import { flowNodeControlField } from './flowNodeDarkTheme';
import { TENCENT_SYSTEM_VOICES } from './tencentSystemVoices';
import type { AudioSpec, AudioSpecField, AudioSpecLocale } from './audioSpec';

type LocaleTextFn = (zh: string, en: string) => string;

type Props = {
  spec: AudioSpec;
  data: Record<string, any>;
  isDark: boolean;
  lt: LocaleTextFn;
  onChange: (patch: Record<string, unknown>) => void;
  stopNodeDrag: (event: React.SyntheticEvent) => void;
  /** unique node id, for datalist element ids */
  nodeId: string;
};

const ltLocale = (lt: LocaleTextFn, loc?: AudioSpecLocale): string =>
  loc ? lt(loc.zh, loc.en) : '';

/**
 * Generic spec-driven form renderer for the audioStudio node. Renders
 * `spec.fields` in order by `type`, honoring `group` headings + `visibleWhen`.
 * Each field's `key` is an exact AudioGenerateDto field name; emitted values are
 * coerced to the right JS type so the run-handler can copy them 1:1 into the
 * payload.
 */
export default function AudioSpecForm({
  spec,
  data,
  isDark,
  lt,
  onChange,
  stopNodeDrag,
  nodeId,
}: Props) {
  const [voiceKeyword, setVoiceKeyword] = React.useState('');
  const controlField = flowNodeControlField(isDark);

  const baseInputStyle: React.CSSProperties = {
    width: '100%',
    height: 28,
    padding: '0 6px',
    fontSize: 12,
    borderRadius: 6,
    ...controlField,
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    color: isDark ? '#9ca3af' : '#6b7280',
  };
  const switchLabelStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    border: controlField.border as string,
    borderRadius: 6,
    padding: '6px 8px',
    fontSize: 12,
    color: controlField.color as string,
    background: controlField.background as string,
  };

  // value for a field = current data value, else declared default
  const fieldValue = (field: AudioSpecField): unknown => {
    const current = data[field.key];
    return current === undefined || current === null ? field.default : current;
  };

  const defaultOf = (key: string): unknown =>
    spec.fields.find((f) => f.key === key)?.default;

  const isVisible = (field: AudioSpecField): boolean => {
    if (!field.visibleWhen) return true;
    const { field: depKey, equals } = field.visibleWhen;
    const actual = data[depKey] ?? defaultOf(depKey) ?? false;
    return actual === equals;
  };

  const update = (key: string, value: unknown) => onChange({ [key]: value });

  // tencentVoicePicker: filter system voices by current srcLang + keyword
  const voiceLanguageCode = React.useMemo(() => {
    const srcLang = typeof data.srcLang === 'string' ? data.srcLang.trim().toLowerCase() : '';
    return srcLang || 'zh';
  }, [data.srcLang]);
  const languageMatchedVoices = React.useMemo(() => {
    const matched = TENCENT_SYSTEM_VOICES.filter((voice) => voice.langCode === voiceLanguageCode);
    return matched.length > 0 ? matched : TENCENT_SYSTEM_VOICES;
  }, [voiceLanguageCode]);
  const filteredVoiceOptions = React.useMemo(() => {
    const keyword = voiceKeyword.trim().toLowerCase();
    if (!keyword) return languageMatchedVoices;
    return languageMatchedVoices.filter((voice) => {
      const label = `${voice.index} ${voice.langZh} ${voice.nameZh} ${voice.genderZh} ${voice.ageZh} ${voice.voiceId}`.toLowerCase();
      return label.includes(keyword);
    });
  }, [languageMatchedVoices, voiceKeyword]);

  const renderField = (field: AudioSpecField): React.ReactNode => {
    if (!isVisible(field)) return null;
    const value = fieldValue(field);
    const label = ltLocale(lt, field.label);
    const placeholder = ltLocale(lt, field.placeholder);

    switch (field.type) {
      case 'text':
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle}>{label}</label>
            <input
              className="nodrag"
              type="text"
              value={typeof value === 'string' ? value : ''}
              placeholder={placeholder}
              onChange={(e) => update(field.key, e.target.value)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
          </div>
        );

      case 'textarea':
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle}>{label}</label>
            <textarea
              className="nodrag"
              value={typeof value === 'string' ? value : ''}
              placeholder={placeholder}
              onChange={(e) => update(field.key, e.target.value)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={{
                width: '100%',
                minHeight: 60,
                resize: 'vertical',
                fontSize: 12,
                lineHeight: 1.45,
                borderRadius: 6,
                padding: '8px 10px',
                ...controlField,
              }}
            />
          </div>
        );

      case 'select': {
        const options = field.options || [];
        const current = value === undefined || value === null ? '' : String(value);
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle}>{label}</label>
            <select
              className="nodrag"
              value={current}
              onChange={(e) => {
                const matched = options.find((opt) => String(opt.value) === e.target.value);
                update(field.key, matched ? matched.value : e.target.value);
              }}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            >
              {options.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {ltLocale(lt, opt.label)}
                </option>
              ))}
            </select>
          </div>
        );
      }

      case 'number':
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle}>{label}</label>
            <input
              className="nodrag"
              type="number"
              value={typeof value === 'number' ? value : ''}
              placeholder={placeholder}
              min={field.min}
              max={field.max}
              step={field.step}
              onChange={(e) =>
                update(field.key, e.target.value === '' ? undefined : Number(e.target.value))
              }
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
          </div>
        );

      case 'slider': {
        const numeric =
          typeof value === 'number' ? value : typeof field.default === 'number' ? field.default : 0;
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <label style={labelStyle}>{label}</label>
              <span style={{ ...labelStyle, color: controlField.color as string }}>{numeric}</span>
            </div>
            <input
              className="nodrag"
              type="range"
              value={numeric}
              min={field.min ?? 0}
              max={field.max ?? 100}
              step={field.step ?? 1}
              onChange={(e) => update(field.key, Number(e.target.value))}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={{ width: '100%' }}
            />
          </div>
        );
      }

      case 'checkbox':
        return (
          <label
            key={field.key}
            className="nodrag"
            onPointerDownCapture={stopNodeDrag}
            onMouseDownCapture={stopNodeDrag}
            style={switchLabelStyle}
          >
            <span>{label}</span>
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => update(field.key, e.target.checked)}
            />
          </label>
        );

      case 'multiSelect': {
        const options = field.options || [];
        const selected: string[] = Array.isArray(value) ? (value as string[]) : [];
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle}>{label}</label>
            <div style={{ display: 'grid', gap: 4 }}>
              {options.map((opt) => {
                const optValue = String(opt.value);
                const checked = selected.includes(optValue);
                return (
                  <label
                    key={optValue}
                    className="nodrag"
                    onPointerDownCapture={stopNodeDrag}
                    onMouseDownCapture={stopNodeDrag}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      fontSize: 12,
                      color: controlField.color as string,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...selected, optValue]
                          : selected.filter((item) => item !== optValue);
                        update(field.key, next);
                      }}
                    />
                    {ltLocale(lt, opt.label)}
                  </label>
                );
              })}
            </div>
          </div>
        );
      }

      case 'voicePicker': {
        const options = field.options || [];
        const current = typeof value === 'string' ? value : '';
        const datalistId = `audiospec-voice-${nodeId}-${field.key}`;
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle}>{label}</label>
            <input
              className="nodrag"
              type="text"
              list={datalistId}
              value={current}
              placeholder={placeholder}
              onChange={(e) => update(field.key, e.target.value)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
            <datalist id={datalistId}>
              {options.map((opt) => (
                <option key={String(opt.value)} value={String(opt.value)}>
                  {ltLocale(lt, opt.label)}
                </option>
              ))}
            </datalist>
          </div>
        );
      }

      case 'tencentVoicePicker': {
        const current = typeof value === 'string' ? value : '';
        return (
          <div key={field.key} style={{ display: 'grid', gap: 4 }}>
            <label style={labelStyle}>{label}</label>
            <input
              className="nodrag"
              type="text"
              value={voiceKeyword}
              placeholder={lt('搜索系统音色', 'Search system voices')}
              onChange={(e) => setVoiceKeyword(e.target.value)}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            />
            <select
              className="nodrag"
              value={current}
              onChange={(e) => {
                const voiceId = e.target.value;
                if (!voiceId) {
                  update(field.key, '');
                  return;
                }
                const matched = TENCENT_SYSTEM_VOICES.find((voice) => voice.voiceId === voiceId);
                onChange({
                  [field.key]: voiceId,
                  speakerGender: matched?.gender || data.speakerGender || 'male',
                });
              }}
              onPointerDownCapture={stopNodeDrag}
              onMouseDownCapture={stopNodeDrag}
              style={baseInputStyle}
            >
              <option value="">{lt('不指定系统音色', 'No system voice')}</option>
              {filteredVoiceOptions.slice(0, 200).map((voice) => (
                <option key={voice.voiceId} value={voice.voiceId}>
                  {`${voice.index}. ${voice.nameZh} (${voice.langZh}/${voice.genderZh}/${voice.ageZh})`}
                </option>
              ))}
            </select>
          </div>
        );
      }

      default:
        return null;
    }
  };

  // group consecutive fields under their `group` heading
  const rendered: React.ReactNode[] = [];
  let lastGroup: string | null = null;
  for (const field of spec.fields) {
    if (!isVisible(field)) continue;
    const groupLabel = field.group ? ltLocale(lt, field.group) : null;
    if (groupLabel && groupLabel !== lastGroup) {
      rendered.push(
        <div
          key={`group-${field.key}`}
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: isDark ? '#9ca3af' : '#6b7280',
            marginTop: 4,
            paddingTop: 6,
            borderTop: `1px solid ${isDark ? '#333333' : '#f0f0f0'}`,
          }}
        >
          {groupLabel}
        </div>
      );
      lastGroup = groupLabel;
    }
    if (!groupLabel) lastGroup = null;
    rendered.push(renderField(field));
  }

  return <div style={{ display: 'grid', gap: 6 }}>{rendered}</div>;
}
