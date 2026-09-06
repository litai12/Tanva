import { useSyncExternalStore } from 'react';

export interface DesktopSkill {
  id: string;
  name: string;
  description: string;
}

export const DESKTOP_SKILLS: readonly DesktopSkill[] = [
  { id: 'architecture', name: '建筑设计', description: '方案推演、空间关系与建筑表达' },
  { id: 'sketchup-mcp', name: 'SketchUp MCP', description: '查询和修改 SketchUp 当前模型' },
  { id: 'rhino-mcp', name: 'Rhino MCP', description: '查询和修改 Rhino / Grasshopper 模型' },
  { id: 'grasshopper-mcp', name: 'Grasshopper MCP', description: '连接 Grasshopper SSE 服务并执行定义工具' },
  { id: 'autocad-mcp', name: 'AutoCAD MCP', description: '读取和编辑 AutoCAD 图纸' },
  { id: 'revit-mcp', name: 'Revit MCP', description: '读取和操作 Revit 建筑模型' },
  { id: '3dsmax-mcp', name: '3ds Max MCP', description: '查询和修改 3ds Max 场景' },
  { id: 'photoshop-mcp', name: 'Photoshop MCP', description: '处理 Photoshop 当前文档' },
  { id: 'illustrator-mcp', name: 'Illustrator MCP', description: '处理 Illustrator 当前文档' },
  { id: 'indesign-mcp', name: 'InDesign MCP', description: '处理 InDesign 当前文档' },
  { id: 'windows-mcp', name: 'Windows MCP', description: '受控执行本机 Windows 文件和窗口操作' },
  { id: 'ppt-master', name: 'PPT Master', description: '生成和修改可编辑演示文稿' },
  { id: 'xlsx', name: 'XLSX', description: '生成和修改真实 Excel 工作簿' },
  { id: 'docx', name: 'DOCX', description: '整理、生成和审阅 Word 文档' },
  { id: 'pdf', name: 'PDF', description: '读取、填充和导出 PDF 文档' },
  { id: 'design-presentation-web', name: '网页汇报', description: '生成网页式建筑汇报和演示内容' },
  { id: 'arch-image-downloader', name: '建筑案例素材', description: '检索和整理建筑图片与案例素材' },
  { id: 'configure-mcp', name: 'MCP 配置', description: '管理本机 MCP 服务连接配置' },
];

const STORAGE_KEY = 'tanva:desktop-skills:v1';
const CHANGE_EVENT = 'tanva:desktop-skills-changed';
const defaultSelected = DESKTOP_SKILLS.map((skill) => skill.id);
const defaultSnapshot = DESKTOP_SKILLS.slice();
let selectedSnapshot: string[] | null = null;
let selectedSkillsSnapshot: DesktopSkill[] | null = null;

const readSelected = (): string[] => {
  if (typeof window === 'undefined') return defaultSelected;
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || 'null');
    if (!Array.isArray(raw)) return defaultSelected;
    const known = new Set(DESKTOP_SKILLS.map((skill) => skill.id));
    const legacyAliases: Record<string, string[]> = { 'docx-pdf': ['docx', 'pdf'] };
    const selected = raw.flatMap((id): string[] => {
      if (typeof id !== 'string') return [];
      if (known.has(id)) return [id];
      return legacyAliases[id] || [];
    });
    return selected.length > 0 ? selected : defaultSelected;
  } catch {
    return defaultSelected;
  }
};

const writeSelected = (selected: string[]) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(selected));
  window.dispatchEvent(new Event(CHANGE_EVENT));
};

export const getSelectedDesktopSkills = (): DesktopSkill[] => {
  if (!selectedSnapshot) selectedSnapshot = readSelected();
  if (!selectedSkillsSnapshot) {
    const selected = new Set(selectedSnapshot);
    selectedSkillsSnapshot = DESKTOP_SKILLS.filter((skill) => selected.has(skill.id));
  }
  return selectedSkillsSnapshot;
};

export const toggleDesktopSkill = (id: string): void => {
  const selected = new Set(selectedSnapshot || readSelected());
  if (selected.has(id)) {
    if (selected.size === 1) return;
    selected.delete(id);
  } else if (DESKTOP_SKILLS.some((skill) => skill.id === id)) {
    selected.add(id);
  }
  const next = DESKTOP_SKILLS.map((skill) => skill.id).filter((skillId) => selected.has(skillId));
  selectedSnapshot = next;
  selectedSkillsSnapshot = DESKTOP_SKILLS.filter((skill) => selected.has(skill.id));
  writeSelected(next);
};

const subscribe = (listener: () => void) => {
  if (typeof window === 'undefined') return () => undefined;
  const refresh = () => {
    selectedSnapshot = readSelected();
    const selected = new Set(selectedSnapshot);
    selectedSkillsSnapshot = DESKTOP_SKILLS.filter((skill) => selected.has(skill.id));
    listener();
  };
  window.addEventListener(CHANGE_EVENT, refresh);
  window.addEventListener('storage', refresh);
  return () => {
    window.removeEventListener(CHANGE_EVENT, refresh);
    window.removeEventListener('storage', refresh);
  };
};

export const useSelectedDesktopSkills = (): DesktopSkill[] =>
  useSyncExternalStore(subscribe, getSelectedDesktopSkills, () => defaultSnapshot);
