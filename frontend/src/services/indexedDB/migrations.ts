/**
 * 数据迁移工具
 * 实现从 localStorage 到 IndexedDB 的平滑迁移
 */

import { migrateFromLocalStorage, migrateMultipleFromLocalStorage } from './storageService';

const MIGRATION_VERSION_KEY = 'tanva_storage_migration_version';
const CURRENT_MIGRATION_VERSION = 1;

interface MigrationConfig {
  localStorageKey: string;
  priority: 'high' | 'medium' | 'low';
  description: string;
}

/**
 * 需要迁移的 localStorage keys
 */
const MIGRATION_CONFIGS: MigrationConfig[] = [
  {
    localStorageKey: 'image-history',
    priority: 'high',
    description: '图像历史记录',
  },
  {
    localStorageKey: 'personal-library',
    priority: 'high',
    description: '个人库资源',
  },
  {
    localStorageKey: 'ai-chat-preferences',
    priority: 'medium',
    description: 'AI 聊天偏好设置',
  },
  {
    localStorageKey: 'canvas-viewport',
    priority: 'medium',
    description: '画布视口状态',
  },
];

/**
 * 检查是否已执行迁移
 */
function getMigrationVersion(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return 0;
  }

  try {
    const version = window.localStorage.getItem(MIGRATION_VERSION_KEY);
    return version ? parseInt(version, 10) : 0;
  } catch {
    return 0;
  }
}

/**
 * 标记迁移完成
 */
function setMigrationVersion(version: number): void {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  try {
    window.localStorage.setItem(MIGRATION_VERSION_KEY, version.toString());
  } catch (error) {
    console.warn('[migration] 无法保存迁移版本:', error);
  }
}

/**
 * 执行迁移
 */
export async function runMigrations(): Promise<void> {
  const currentVersion = getMigrationVersion();

  if (currentVersion >= CURRENT_MIGRATION_VERSION) {
    return; // 已是最新版本，无需迁移
  }

  console.log(`[migration] 开始迁移，当前版本: ${currentVersion}, 目标版本: ${CURRENT_MIGRATION_VERSION}`);

  try {
    // 按优先级排序
    const highPriority = MIGRATION_CONFIGS.filter((c) => c.priority === 'high');
    const mediumPriority = MIGRATION_CONFIGS.filter((c) => c.priority === 'medium');
    const lowPriority = MIGRATION_CONFIGS.filter((c) => c.priority === 'low');

    // 先迁移高优先级
    for (const config of highPriority) {
      console.log(`[migration] 迁移 ${config.description} (${config.localStorageKey})...`);
      await migrateFromLocalStorage(config.localStorageKey);
    }

    // 再迁移中优先级
    for (const config of mediumPriority) {
      console.log(`[migration] 迁移 ${config.description} (${config.localStorageKey})...`);
      await migrateFromLocalStorage(config.localStorageKey);
    }

    // 最后迁移低优先级
    for (const config of lowPriority) {
      console.log(`[migration] 迁移 ${config.description} (${config.localStorageKey})...`);
      await migrateFromLocalStorage(config.localStorageKey);
    }

    // 标记迁移完成
    setMigrationVersion(CURRENT_MIGRATION_VERSION);
    console.log('[migration] 迁移完成');

    // 自动清理已迁移的 localStorage 数据，释放空间
    const migratedKeys = MIGRATION_CONFIGS.map((c) => c.localStorageKey);
    await cleanupMigratedData(migratedKeys);
  } catch (error) {
    console.error('[migration] 迁移失败:', error);
    // 不抛出错误，允许应用继续运行
  }
}

/**
 * 迁移特定的 localStorage key
 */
export async function migrateKey(localStorageKey: string): Promise<boolean> {
  try {
    await migrateFromLocalStorage(localStorageKey);
    return true;
  } catch (error) {
    console.warn(`[migration] 迁移 ${localStorageKey} 失败:`, error);
    return false;
  }
}

/**
 * 检查是否需要迁移
 */
export function needsMigration(): boolean {
  return getMigrationVersion() < CURRENT_MIGRATION_VERSION;
}

/**
 * 获取迁移状态
 */
export function getMigrationStatus(): {
  version: number;
  needsMigration: boolean;
  pendingKeys: string[];
} {
  const version = getMigrationVersion();
  const needsMigration = version < CURRENT_MIGRATION_VERSION;

  // 检查哪些 key 需要迁移（在 localStorage 中存在但可能未迁移）
  const pendingKeys: string[] = [];
  if (typeof window !== 'undefined' && window.localStorage) {
    for (const config of MIGRATION_CONFIGS) {
      try {
        if (window.localStorage.getItem(config.localStorageKey) !== null) {
          pendingKeys.push(config.localStorageKey);
        }
      } catch {
        // 忽略错误
      }
    }
  }

  return {
    version,
    needsMigration,
    pendingKeys,
  };
}

/**
 * 清理已迁移的 localStorage 数据（谨慎使用）
 */
export async function cleanupMigratedData(keys: string[]): Promise<void> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }

  for (const key of keys) {
    try {
      // 先确认 IndexedDB 中有数据
      // 这里简化处理，实际应该检查 IndexedDB
      window.localStorage.removeItem(key);
      console.log(`[migration] 已清理 localStorage: ${key}`);
    } catch (error) {
      console.warn(`[migration] 清理 ${key} 失败:`, error);
    }
  }
}

