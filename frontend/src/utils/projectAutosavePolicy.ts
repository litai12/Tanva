import type { ProjectContentSnapshot } from '@/types/project';

/**
 * 自动保存只接受至少包含一个 Flow 节点的项目快照。
 *
 * Flow 在项目切换、水合或组件重建期间可能短暂为空；空快照不得参与自动保存，
 * 否则会把云端已有工作流覆盖成空数据。手动保存有独立链路，不受此策略影响。
 */
export function hasFlowNodesForAutosave(
  content: Pick<ProjectContentSnapshot, 'flow'> | null | undefined
): boolean {
  return Array.isArray(content?.flow?.nodes) && content.flow.nodes.length > 0;
}
