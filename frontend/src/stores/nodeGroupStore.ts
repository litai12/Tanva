import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { NodeGroup } from '../components/flow/types';

interface NodeGroupState {
  // 组数据: groupId -> NodeGroup
  groups: Record<string, NodeGroup>;

  // 创建组
  createGroup: (nodeIds: string[], initialPrompts?: string[], initialAspectRatio?: string) => string;

  // 解散组
  dissolveGroup: (groupId: string) => void;

  // 更新组的提示词
  updateGroupPrompts: (groupId: string, prompts: string[]) => void;

  // 更新组的长宽比
  updateGroupAspectRatio: (groupId: string, aspectRatio: string) => void;

  // 添加节点到组
  addNodeToGroup: (groupId: string, nodeId: string) => void;

  // 从组中移除节点
  removeNodeFromGroup: (groupId: string, nodeId: string) => void;

  // 获取节点所属的组
  getGroupByNodeId: (nodeId: string) => NodeGroup | undefined;

  // 批量设置组（用于加载保存的数据）
  setGroups: (groups: Record<string, NodeGroup>) => void;

  // 清空所有组
  clearGroups: () => void;
}

// 生成唯一ID
const generateGroupId = (): string => {
  return `group_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
};

export const useNodeGroupStore = create<NodeGroupState>()(
  subscribeWithSelector((set, get) => ({
    groups: {},

    createGroup: (nodeIds, initialPrompts = [''], initialAspectRatio = '1:1') => {
      const groupId = generateGroupId();
      const newGroup: NodeGroup = {
        id: groupId,
        nodeIds: [...nodeIds],
        prompts: initialPrompts,
        aspectRatio: initialAspectRatio,
        createdAt: Date.now(),
      };

      set((state) => ({
        groups: {
          ...state.groups,
          [groupId]: newGroup,
        },
      }));

      return groupId;
    },

    dissolveGroup: (groupId) => {
      set((state) => {
        const newGroups = { ...state.groups };
        delete newGroups[groupId];
        return { groups: newGroups };
      });
    },

    updateGroupPrompts: (groupId, prompts) => {
      set((state) => {
        const group = state.groups[groupId];
        if (!group) return state;

        return {
          groups: {
            ...state.groups,
            [groupId]: {
              ...group,
              prompts,
            },
          },
        };
      });
    },

    updateGroupAspectRatio: (groupId, aspectRatio) => {
      set((state) => {
        const group = state.groups[groupId];
        if (!group) return state;

        return {
          groups: {
            ...state.groups,
            [groupId]: {
              ...group,
              aspectRatio,
            },
          },
        };
      });
    },

    addNodeToGroup: (groupId, nodeId) => {
      set((state) => {
        const group = state.groups[groupId];
        if (!group || group.nodeIds.includes(nodeId)) return state;

        return {
          groups: {
            ...state.groups,
            [groupId]: {
              ...group,
              nodeIds: [...group.nodeIds, nodeId],
            },
          },
        };
      });
    },

    removeNodeFromGroup: (groupId, nodeId) => {
      set((state) => {
        const group = state.groups[groupId];
        if (!group) return state;

        const newNodeIds = group.nodeIds.filter((id: string) => id !== nodeId);

        // 如果组内只剩一个或没有节点，解散组
        if (newNodeIds.length <= 1) {
          const newGroups = { ...state.groups };
          delete newGroups[groupId];
          return { groups: newGroups };
        }

        return {
          groups: {
            ...state.groups,
            [groupId]: {
              ...group,
              nodeIds: newNodeIds,
            },
          },
        };
      });
    },

    getGroupByNodeId: (nodeId) => {
      const { groups } = get();
      return Object.values(groups).find((group) => group.nodeIds.includes(nodeId));
    },

    setGroups: (groups) => {
      set({ groups });
    },

    clearGroups: () => {
      set({ groups: {} });
    },
  }))
);

// 选择器：获取所有组
export const useAllGroups = () => useNodeGroupStore((state) => state.groups);

// 选择器：获取特定组
export const useGroup = (groupId: string) =>
  useNodeGroupStore((state) => state.groups[groupId]);

// 选择器：获取节点所属组ID
export const useNodeGroupId = (nodeId: string) =>
  useNodeGroupStore((state) => {
    const group = Object.values(state.groups).find((g) => g.nodeIds.includes(nodeId));
    return group?.id;
  });
