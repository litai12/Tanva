import React from 'react';
import { createPortal } from 'react-dom';
import type { XiaotChatModel } from '@/services/agentBackendAPI';
import {
  storyboardSkillApi,
  type StoryboardSkill,
} from '@/services/storyboardSkillApi';
import {
  DOC_TEXT_ACCEPT,
  extractTextFromDocFile,
} from '@/utils/documentTextExtract';
import { useLocaleText } from '@/utils/localeText';
import type { StoryboardPromptTableData } from '../types';
import {
  DEFAULT_SCRIPT_TO_STORYBOARD_SKILL,
  generateStoryboardFromScript,
  getStoryboardConversionModelLabel,
} from '../storyboardScriptConversion';

type Props = {
  open: boolean;
  dark: boolean;
  table: StoryboardPromptTableData;
  model: XiaotChatModel;
  projectId?: string | null;
  onClose: () => void;
  onApply: (rawStoryboard: string) => void;
};

type UploadTarget = 'skill' | 'script';

const SKILL_MAX_CHARS = 50_000;
const SCRIPT_MAX_CHARS = 200_000;

const defaultSkillName = '我的分镜 Skill';

const sortSkills = (skills: StoryboardSkill[]): StoryboardSkill[] =>
  skills.slice().sort((left, right) => (
    new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
  ));

const StoryboardScriptToShotsDialog: React.FC<Props> = ({
  open,
  dark,
  table,
  model,
  projectId,
  onClose,
  onApply,
}) => {
  const { lt } = useLocaleText();
  const [skills, setSkills] = React.useState<StoryboardSkill[]>([]);
  const [selectedSkillId, setSelectedSkillId] = React.useState('');
  const [skillName, setSkillName] = React.useState(defaultSkillName);
  const [skillText, setSkillText] = React.useState(
    DEFAULT_SCRIPT_TO_STORYBOARD_SKILL,
  );
  const [scriptText, setScriptText] = React.useState('');
  const [skillFileName, setSkillFileName] = React.useState('');
  const [scriptFileName, setScriptFileName] = React.useState('');
  const [loadingSkills, setLoadingSkills] = React.useState(false);
  const [savingSkill, setSavingSkill] = React.useState(false);
  const [deletingSkill, setDeletingSkill] = React.useState(false);
  const [uploadingTarget, setUploadingTarget] =
    React.useState<UploadTarget | null>(null);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState('');
  const skillUploadRef = React.useRef<HTMLInputElement>(null);
  const scriptUploadRef = React.useRef<HTMLInputElement>(null);
  const generateAbortRef = React.useRef<AbortController | null>(null);

  const selectedSavedSkill = skills.find(
    (skill) => skill.id === selectedSkillId,
  );
  const background = dark ? '#171717' : '#ffffff';
  const panelBackground = dark ? '#202020' : '#f8fafc';
  const inputBackground = dark ? '#121212' : '#ffffff';
  const border = dark ? '#3a3a3a' : '#dbe2ea';
  const text = dark ? '#f4f4f5' : '#172033';
  const muted = dark ? '#a3a3a3' : '#64748b';
  const disabled = generating || savingSkill || deletingSkill;

  const showToast = React.useCallback((
    message: string,
    type: 'success' | 'warning' | 'error' = 'success',
  ) => {
    window.dispatchEvent(new CustomEvent('toast', {
      detail: { message, type },
    }));
  }, []);

  const loadSkills = React.useCallback(async () => {
    setLoadingSkills(true);
    try {
      setSkills(sortSkills(await storyboardSkillApi.list()));
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : lt('Skill 库加载失败', 'Failed to load Skill library'),
      );
    } finally {
      setLoadingSkills(false);
    }
  }, [lt]);

  React.useEffect(() => {
    if (!open) return;
    setError('');
    void loadSkills();
  }, [loadSkills, open]);

  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || generating) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [generating, onClose, open]);

  React.useEffect(() => () => {
    generateAbortRef.current?.abort();
  }, []);

  const applySkillSelection = React.useCallback((id: string) => {
    setSelectedSkillId(id);
    setError('');
    if (!id) {
      setSkillName(defaultSkillName);
      setSkillText(DEFAULT_SCRIPT_TO_STORYBOARD_SKILL);
      setSkillFileName('');
      return;
    }
    const next = skills.find((skill) => skill.id === id);
    if (!next) return;
    setSkillName(next.name);
    setSkillText(next.content);
    setSkillFileName('');
  }, [skills]);

  const fillFromFile = React.useCallback(async (
    target: UploadTarget,
    file: File,
  ) => {
    setUploadingTarget(target);
    setError('');
    try {
      const result = await extractTextFromDocFile(file);
      const limit = target === 'skill' ? SKILL_MAX_CHARS : SCRIPT_MAX_CHARS;
      const nextText = result.text.slice(0, limit);
      if (target === 'skill') {
        setSkillText(nextText);
        setSkillFileName(result.fileName);
        if (!selectedSkillId) {
          setSkillName(
            result.fileName.replace(/\.(?:txt|md|markdown|docx)$/i, '') ||
              defaultSkillName,
          );
        }
      } else {
        setScriptText(nextText);
        setScriptFileName(result.fileName);
      }
      if (result.truncated || result.text.length > limit) {
        showToast(
          lt(
            `${result.fileName} 内容较长，已按输入上限截断`,
            `${result.fileName} was truncated to the input limit`,
          ),
          'warning',
        );
      }
    } catch (uploadError) {
      setError(
        uploadError instanceof Error
          ? uploadError.message
          : lt('文本读取失败', 'Failed to read text'),
      );
    } finally {
      setUploadingTarget(null);
    }
  }, [lt, selectedSkillId, showToast]);

  const handleFileChange = React.useCallback((
    target: UploadTarget,
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) void fillFromFile(target, file);
  }, [fillFromFile]);

  const saveSkill = React.useCallback(async () => {
    const name = skillName.trim();
    const content = skillText.trim();
    if (!name) {
      setError(lt('请输入 Skill 名称', 'Enter a Skill name'));
      return;
    }
    if (!content) {
      setError(lt('请输入 Skill 内容', 'Enter Skill content'));
      return;
    }
    setSavingSkill(true);
    setError('');
    try {
      const saved = await storyboardSkillApi.upsert({
        id: selectedSavedSkill?.id,
        name,
        content,
      });
      setSkills((current) => sortSkills([
        saved,
        ...current.filter((skill) => skill.id !== saved.id),
      ]));
      setSelectedSkillId(saved.id);
      setSkillName(saved.name);
      setSkillText(saved.content);
      showToast(
        selectedSavedSkill
          ? lt('Skill 已更新', 'Skill updated')
          : lt('Skill 已存入账号库', 'Skill saved to your account'),
      );
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : lt('Skill 保存失败', 'Failed to save Skill'),
      );
    } finally {
      setSavingSkill(false);
    }
  }, [
    lt,
    selectedSavedSkill,
    showToast,
    skillName,
    skillText,
  ]);

  const deleteSkill = React.useCallback(async () => {
    if (!selectedSavedSkill) return;
    if (!window.confirm(
      lt(
        `确定删除 Skill「${selectedSavedSkill.name}」吗？`,
        `Delete Skill "${selectedSavedSkill.name}"?`,
      ),
    )) {
      return;
    }
    setDeletingSkill(true);
    setError('');
    try {
      await storyboardSkillApi.remove(selectedSavedSkill.id);
      setSkills((current) => current.filter(
        (skill) => skill.id !== selectedSavedSkill.id,
      ));
      setSelectedSkillId('');
      setSkillName(defaultSkillName);
      setSkillText(DEFAULT_SCRIPT_TO_STORYBOARD_SKILL);
      setSkillFileName('');
      showToast(lt('Skill 已删除', 'Skill deleted'));
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : lt('Skill 删除失败', 'Failed to delete Skill'),
      );
    } finally {
      setDeletingSkill(false);
    }
  }, [lt, selectedSavedSkill, showToast]);

  const generate = React.useCallback(async () => {
    const script = scriptText.trim();
    if (!script) {
      setError(lt('请粘贴剧本或上传剧本文本', 'Paste or upload a script'));
      return;
    }
    setGenerating(true);
    setError('');
    const controller = new AbortController();
    generateAbortRef.current = controller;
    try {
      const output = await generateStoryboardFromScript({
        skill: skillText,
        script,
        table,
        model,
        projectId,
        signal: controller.signal,
      });
      onApply(output);
      showToast(
        lt(
          `已使用 ${getStoryboardConversionModelLabel(model)} 生成分镜`,
          `Storyboard generated with ${getStoryboardConversionModelLabel(model)}`,
        ),
      );
      onClose();
    } catch (generateError) {
      if (
        generateError instanceof Error &&
        generateError.name === 'AbortError'
      ) {
        return;
      }
      setError(
        generateError instanceof Error
          ? generateError.message
          : lt('剧本转分镜失败', 'Script-to-storyboard failed'),
      );
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
      }
      setGenerating(false);
    }
  }, [
    lt,
    model,
    onApply,
    onClose,
    projectId,
    scriptText,
    showToast,
    skillText,
    table,
  ]);

  if (!open || typeof document === 'undefined') return null;

  const smallButton = (
    options: { primary?: boolean; danger?: boolean; inactive?: boolean } = {},
  ): React.CSSProperties => ({
    height: 30,
    padding: '0 11px',
    borderRadius: 7,
    border: options.primary
      ? '1px solid #2563eb'
      : `1px solid ${options.danger ? '#ef4444' : border}`,
    background: options.primary
      ? '#2563eb'
      : options.danger
        ? (dark ? '#301a1a' : '#fff5f5')
        : inputBackground,
    color: options.primary
      ? '#ffffff'
      : options.danger
        ? (dark ? '#fca5a5' : '#dc2626')
        : text,
    fontSize: 12,
    fontWeight: 600,
    cursor: options.inactive ? 'not-allowed' : 'pointer',
    opacity: options.inactive ? 0.5 : 1,
    whiteSpace: 'nowrap',
  });

  const textareaStyle: React.CSSProperties = {
    width: '100%',
    minHeight: 190,
    flex: 1,
    resize: 'none',
    boxSizing: 'border-box',
    border: `1px solid ${border}`,
    borderRadius: 9,
    padding: '10px 11px',
    outline: 'none',
    background: inputBackground,
    color: text,
    fontFamily: 'inherit',
    fontSize: 12,
    lineHeight: 1.55,
  };

  return createPortal(
    <div
      className="nodrag nopan nowheel"
      role="presentation"
      onPointerDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget && !generating) onClose();
      }}
      onWheelCapture={(event) => event.stopPropagation()}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 14000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(2, 6, 23, 0.62)',
        backdropFilter: 'blur(3px)',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={lt('剧本转分镜', 'Script to Storyboard')}
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          width: 'min(1120px, calc(100vw - 48px))',
          height: 'min(760px, calc(100vh - 48px))',
          minHeight: 560,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          border: `1px solid ${border}`,
          borderRadius: 16,
          background,
          color: text,
          boxShadow: '0 28px 90px rgba(0,0,0,0.4)',
        }}
      >
        <div
          style={{
            minHeight: 64,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 18px',
            borderBottom: `1px solid ${border}`,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              {lt('剧本转分镜', 'Script to Storyboard')}
            </div>
            <div style={{ marginTop: 3, fontSize: 11, color: muted }}>
              {lt(
                '按当前动态列生成，并直接覆盖回填当前分镜表',
                'Generate with the current dynamic columns and replace this table',
              )}
            </div>
          </div>
          <span
            title={lt(
              '与小T对话当前选择的大脑模型保持一致',
              'Uses the model currently selected for XiaoT chat',
            )}
            style={{
              marginLeft: 'auto',
              padding: '5px 9px',
              borderRadius: 999,
              border: `1px solid ${border}`,
              background: panelBackground,
              color: text,
              fontSize: 11,
              fontWeight: 600,
              whiteSpace: 'nowrap',
            }}
          >
            {getStoryboardConversionModelLabel(model)}
          </span>
          <button
            type="button"
            disabled={generating}
            onClick={onClose}
            style={smallButton({ inactive: generating })}
          >
            {lt('关闭', 'Close')}
          </button>
        </div>

        <div
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)',
            gap: 14,
            padding: 14,
            overflow: 'auto',
          }}
        >
          <section
            style={{
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              padding: 12,
              border: `1px solid ${border}`,
              borderRadius: 12,
              background: panelBackground,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>1. Skill</div>
              <span style={{ color: muted, fontSize: 11 }}>
                {lt('导演规则与拆镜偏好', 'Directing rules and shot preferences')}
              </span>
              <button
                type="button"
                disabled={disabled || uploadingTarget === 'skill'}
                onClick={() => skillUploadRef.current?.click()}
                style={{
                  ...smallButton({
                    inactive: disabled || uploadingTarget === 'skill',
                  }),
                  marginLeft: 'auto',
                }}
              >
                {uploadingTarget === 'skill'
                  ? lt('读取中…', 'Reading…')
                  : lt('上传文本', 'Upload text')}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: muted, fontSize: 10 }}>
                  {lt('账号 Skill 库', 'Account Skill library')}
                </span>
                <select
                  value={selectedSkillId}
                  disabled={disabled || loadingSkills}
                  onChange={(event) => applySkillSelection(event.target.value)}
                  style={{
                    height: 32,
                    border: `1px solid ${border}`,
                    borderRadius: 7,
                    padding: '0 8px',
                    outline: 'none',
                    background: inputBackground,
                    color: text,
                    fontSize: 12,
                  }}
                >
                  <option value="">
                    {loadingSkills
                      ? lt('加载中…', 'Loading…')
                      : lt('内置默认 Skill', 'Built-in default Skill')}
                  </option>
                  {skills.map((skill) => (
                    <option key={skill.id} value={skill.id}>
                      {skill.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ color: muted, fontSize: 10 }}>
                  {lt('Skill 名称', 'Skill name')}
                </span>
                <input
                  value={skillName}
                  disabled={disabled}
                  maxLength={120}
                  onChange={(event) => setSkillName(event.target.value)}
                  style={{
                    height: 32,
                    boxSizing: 'border-box',
                    border: `1px solid ${border}`,
                    borderRadius: 7,
                    padding: '0 8px',
                    outline: 'none',
                    background: inputBackground,
                    color: text,
                    fontSize: 12,
                  }}
                />
              </label>
            </div>

            <textarea
              value={skillText}
              disabled={disabled}
              maxLength={SKILL_MAX_CHARS}
              onChange={(event) => setSkillText(event.target.value)}
              placeholder={lt(
                '输入分镜拆解规则，也可从文本文件填充',
                'Enter shot breakdown rules or fill from a text file',
              )}
              style={textareaStyle}
            />

            <div
              style={{
                minHeight: 30,
                display: 'flex',
                alignItems: 'center',
                gap: 7,
              }}
            >
              <span
                title={skillFileName}
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  color: muted,
                  fontSize: 10,
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {skillFileName ||
                  lt(
                    `${skillText.length.toLocaleString()} / ${SKILL_MAX_CHARS.toLocaleString()} 字符`,
                    `${skillText.length.toLocaleString()} / ${SKILL_MAX_CHARS.toLocaleString()} chars`,
                  )}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => void saveSkill()}
                style={smallButton({ inactive: disabled })}
              >
                {savingSkill
                  ? lt('保存中…', 'Saving…')
                  : selectedSavedSkill
                    ? lt('更新 Skill', 'Update Skill')
                    : lt('存入 Skill 库', 'Save to library')}
              </button>
              <button
                type="button"
                disabled={disabled || !selectedSavedSkill}
                onClick={() => void deleteSkill()}
                style={smallButton({
                  danger: true,
                  inactive: disabled || !selectedSavedSkill,
                })}
              >
                {deletingSkill ? lt('删除中…', 'Deleting…') : lt('删除', 'Delete')}
              </button>
            </div>
          </section>

          <section
            style={{
              minWidth: 0,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 9,
              padding: 12,
              border: `1px solid ${border}`,
              borderRadius: 12,
              background: panelBackground,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 700 }}>
                {lt('2. 剧本', '2. Script')}
              </div>
              <span style={{ color: muted, fontSize: 11 }}>
                {lt('粘贴正文或上传文本', 'Paste or upload script text')}
              </span>
              <button
                type="button"
                disabled={disabled || uploadingTarget === 'script'}
                onClick={() => scriptUploadRef.current?.click()}
                style={{
                  ...smallButton({
                    inactive: disabled || uploadingTarget === 'script',
                  }),
                  marginLeft: 'auto',
                }}
              >
                {uploadingTarget === 'script'
                  ? lt('读取中…', 'Reading…')
                  : lt('上传文本', 'Upload text')}
              </button>
            </div>

            <textarea
              value={scriptText}
              disabled={disabled}
              maxLength={SCRIPT_MAX_CHARS}
              onChange={(event) => setScriptText(event.target.value)}
              placeholder={lt(
                '在这里粘贴完整剧本、小说章节或场次文本…',
                'Paste a full script, chapter, or scene text here…',
              )}
              style={{ ...textareaStyle, minHeight: 284 }}
            />

            <div
              style={{
                minHeight: 30,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span
                title={scriptFileName}
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  color: muted,
                  fontSize: 10,
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {scriptFileName ||
                  lt(
                    `${scriptText.length.toLocaleString()} / ${SCRIPT_MAX_CHARS.toLocaleString()} 字符`,
                    `${scriptText.length.toLocaleString()} / ${SCRIPT_MAX_CHARS.toLocaleString()} chars`,
                  )}
              </span>
              <span style={{ color: muted, fontSize: 10 }}>
                {lt('.txt / .md / .docx', '.txt / .md / .docx')}
              </span>
            </div>
          </section>
        </div>

        <div
          style={{
            minHeight: 62,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '10px 18px',
            borderTop: `1px solid ${border}`,
          }}
        >
          <div
            role={error ? 'alert' : undefined}
            style={{
              flex: 1,
              minWidth: 0,
              color: error ? (dark ? '#fca5a5' : '#dc2626') : muted,
              fontSize: 11,
              lineHeight: 1.4,
            }}
          >
            {error || lt(
              '生成会覆盖当前分镜表；Skill 库按账号保存，在所有项目中可用。',
              'Generation replaces this table. Skills are account-wide across projects.',
            )}
          </div>
          <button
            type="button"
            disabled={disabled || !scriptText.trim()}
            onClick={() => void generate()}
            style={{
              ...smallButton({
                primary: true,
                inactive: disabled || !scriptText.trim(),
              }),
              minWidth: 132,
              height: 38,
              fontSize: 13,
            }}
          >
            {generating
              ? lt('小T 正在拆分…', 'XiaoT is converting…')
              : lt('生成并回填分镜', 'Generate storyboard')}
          </button>
        </div>

        <input
          ref={skillUploadRef}
          type="file"
          accept={DOC_TEXT_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => handleFileChange('skill', event)}
          style={{ display: 'none' }}
        />
        <input
          ref={scriptUploadRef}
          type="file"
          accept={DOC_TEXT_ACCEPT}
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => handleFileChange('script', event)}
          style={{ display: 'none' }}
        />
      </div>
    </div>,
    document.body,
  );
};

export default StoryboardScriptToShotsDialog;
