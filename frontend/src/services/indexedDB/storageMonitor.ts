/**
 * 存储监控服务
 * 监控存储使用情况，提供清理功能和用户提示
 */

import { getStorageUsage, cleanupExpiredRecords } from './storageService';
import { runMigrations, getMigrationStatus } from './migrations';

export interface StorageStatus {
  recordCount: number;
  estimatedSize: number;
  estimatedSizeMB: number;
  needsCleanup: boolean;
  migrationStatus: {
    version: number;
    needsMigration: boolean;
    pendingKeys: string[];
  };
}

/**
 * 获取存储状态
 */
export async function getStorageStatus(): Promise<StorageStatus> {
  const usage = await getStorageUsage();
  const migrationStatus = getMigrationStatus();

  const estimatedSizeMB = usage.estimatedSize / (1024 * 1024);
  // 如果超过 100MB，建议清理
  const needsCleanup = estimatedSizeMB > 100 || usage.recordCount > 1000;

  return {
    recordCount: usage.recordCount,
    estimatedSize: usage.estimatedSize,
    estimatedSizeMB: Math.round(estimatedSizeMB * 100) / 100,
    needsCleanup,
    migrationStatus,
  };
}

/**
 * 清理存储
 */
export async function cleanupStorage(options?: {
  maxAge?: number; // 清理多少天前的数据（默认 30 天）
  force?: boolean; // 是否强制清理
}): Promise<{
  success: boolean;
  message: string;
}> {
  try {
    const maxAge = options?.maxAge ?? 30 * 24 * 60 * 60 * 1000; // 默认 30 天
    await cleanupExpiredRecords(maxAge);

    return {
      success: true,
      message: '存储清理完成',
    };
  } catch (error) {
    console.error('[StorageMonitor] 清理失败:', error);
    return {
      success: false,
      message: `清理失败: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * 初始化存储系统
 * 在应用启动时调用，执行迁移和监控
 */
export async function initializeStorage(): Promise<void> {
  try {
    // 1. 执行数据迁移
    const migrationStatus = getMigrationStatus();
    if (migrationStatus.needsMigration) {
      console.log('[StorageMonitor] 检测到需要迁移的数据，开始迁移...');
      await runMigrations();
    }

    // 2. 检查存储状态
    const status = await getStorageStatus();
    
    if (status.needsCleanup) {
      console.warn(
        `[StorageMonitor] 存储使用量较大: ${status.estimatedSizeMB}MB, ${status.recordCount} 条记录。建议清理。`
      );
    } else {
      console.log(
        `[StorageMonitor] 存储状态正常: ${status.estimatedSizeMB}MB, ${status.recordCount} 条记录`
      );
    }

    // 3. 自动清理过期数据（静默执行，不阻塞）
    cleanupExpiredRecords(30 * 24 * 60 * 60 * 1000).catch((error) => {
      console.warn('[StorageMonitor] 自动清理失败:', error);
    });
  } catch (error) {
    console.error('[StorageMonitor] 初始化失败:', error);
    // 不抛出错误，允许应用继续运行
  }
}

/**
 * 格式化存储大小
 */
export function formatStorageSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024 * 100) / 100} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${Math.round(bytes / (1024 * 1024) * 100) / 100} MB`;
  }
  return `${Math.round(bytes / (1024 * 1024 * 1024) * 100) / 100} GB`;
}

/**
 * 显示存储使用情况的用户提示（可选）
 * 可以在设置页面或开发者工具中调用
 */
export async function showStorageInfo(): Promise<string> {
  const status = await getStorageStatus();
  
  const lines = [
    '📊 存储使用情况',
    `记录数: ${status.recordCount}`,
    `估算大小: ${formatStorageSize(status.estimatedSize)}`,
    `迁移状态: ${status.migrationStatus.needsMigration ? '需要迁移' : '已是最新'}`,
  ];

  if (status.migrationStatus.pendingKeys.length > 0) {
    lines.push(`待迁移: ${status.migrationStatus.pendingKeys.join(', ')}`);
  }

  if (status.needsCleanup) {
    lines.push('⚠️ 建议清理过期数据');
  }

  return lines.join('\n');
}

