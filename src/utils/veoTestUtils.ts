/**
 * Veo 测试工具库
 * 提供测试辅助函数和 Mock 数据
 */

import type { VideoGenerateRequest, VideoExtendRequest, VideoGenerationResult } from '@/types/video';

/**
 * Mock 测试数据
 */
export const MockData = {
  // 测试提示词
  prompts: {
    nature: '一个美丽的山区风景，蓝天白云，树木摇曳',
    animal: '一只可爱的柯基犬在草地上奔跑',
    urban: '城市夜景，霓虹灯闪烁，人群熙攘',
    sunset: '海滩日落，金色阳光照在海面上',
    forest: '森林中的小径，阳光透过树叶洒下斑驳的光影',
    ocean: '海浪拍打沙滩，海鸥在空中飞翔'
  },

  // 测试请求
  requests: {
    basic: {
      prompt: '一只可爱的柯基犬在草地上奔跑',
      duration: 4,
      resolution: '720p'
    } as VideoGenerateRequest,
    hd: {
      prompt: '城市夜景，霓虹灯闪烁',
      duration: 8,
      resolution: '1080p'
    } as VideoGenerateRequest,
    long: {
      prompt: '海滩日落',
      duration: 8,
      resolution: '720p'
    } as VideoGenerateRequest
  }
};

/**
 * 测试场景集合
 */
export const TestScenarios = {
  /**
   * 基础测试：验证基本功能
   */
  basic: {
    name: '基础功能测试',
    description: '测试基本的视频生成功能',
    tests: [
      {
        name: '生成4秒视频',
        request: MockData.requests.basic
      },
      {
        name: '生成8秒视频',
        request: {
          ...MockData.requests.basic,
          duration: 8 as const
        }
      }
    ]
  },

  /**
   * 分辨率测试
   */
  resolution: {
    name: '分辨率测试',
    description: '测试不同分辨率的输出',
    tests: [
      {
        name: '720p 分辨率',
        request: {
          ...MockData.requests.basic,
          resolution: '720p' as const
        }
      },
      {
        name: '1080p 分辨率',
        request: {
          ...MockData.requests.basic,
          resolution: '1080p' as const
        }
      }
    ]
  },

  /**
   * 时长测试
   */
  duration: {
    name: '时长测试',
    description: '测试不同时长的输出',
    tests: [
      { name: '4秒', request: { ...MockData.requests.basic, duration: 4 as const } },
      { name: '6秒', request: { ...MockData.requests.basic, duration: 6 as const } },
      { name: '8秒', request: { ...MockData.requests.basic, duration: 8 as const } }
    ]
  }
};

/**
 * 性能测试工具
 */
export class PerformanceMonitor {
  private startTime: number = 0;
  private marks: Map<string, number> = new Map();

  start() {
    this.startTime = performance.now();
  }

  mark(label: string) {
    this.marks.set(label, performance.now());
  }

  measure(label: string): number {
    if (this.marks.has(label)) {
      return performance.now() - this.marks.get(label)!;
    }
    return performance.now() - this.startTime;
  }

  getDuration(): number {
    return performance.now() - this.startTime;
  }

  report(): string {
    return `总耗时: ${this.getDuration().toFixed(2)}ms`;
  }
}

/**
 * 测试数据生成器
 */
export class TestDataGenerator {
  static generateVideoRequest(override?: Partial<VideoGenerateRequest>): VideoGenerateRequest {
    return {
      prompt: '一只可爱的狗在公园里玩耍',
      duration: 8 as const,
      resolution: '720p' as const,
      ...override
    };
  }

  static generateExtendRequest(videoId: string): VideoExtendRequest {
    return {
      sourceVideoId: videoId,
      extensionSeconds: 10,
      extensionPrompt: '继续场景...'
    };
  }

  static generateRandomPrompt(): string {
    const prompts = Object.values(MockData.prompts);
    return prompts[Math.floor(Math.random() * prompts.length)];
  }
}

/**
 * 结果验证器
 */
export class ResultValidator {
  static validateVideoRequest(request: VideoGenerateRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!request.prompt || request.prompt.trim().length === 0) {
      errors.push('提示词不能为空');
    }

    if (request.prompt && request.prompt.length > 1000) {
      errors.push('提示词过长，最多1000字符');
    }

    if (request.duration && ![4, 6, 8].includes(request.duration)) {
      errors.push('无效的时长，必须是 4、6 或 8 秒');
    }

    if (request.resolution && !['720p', '1080p'].includes(request.resolution)) {
      errors.push('无效的分辨率，必须是 720p 或 1080p');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  static validateVideoResult(result: VideoGenerationResult): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!result.id) errors.push('缺少视频 ID');
    if (!result.videoUrl) errors.push('缺少视频 URL');
    if (!result.prompt) errors.push('缺少提示词');
    if (!result.model) errors.push('缺少模型信息');
    if (!result.duration || result.duration <= 0) errors.push('无效的时长');
    if (!['720p', '1080p'].includes(result.resolution || '')) errors.push('无效的分辨率');
    if (!['pending', 'processing', 'completed', 'failed'].includes(result.status)) {
      errors.push('无效的状态');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

/**
 * 日志管理器
 */
export class LogManager {
  private logs: Array<{ timestamp: Date; level: string; message: string }> = [];

  log(level: 'INFO' | 'SUCCESS' | 'ERROR' | 'WARN', message: string) {
    const entry = {
      timestamp: new Date(),
      level,
      message
    };
    this.logs.push(entry);
    console.log(`[${entry.timestamp.toLocaleTimeString()}] ${level}: ${message}`);
  }

  info(message: string) {
    this.log('INFO', message);
  }

  success(message: string) {
    this.log('SUCCESS', message);
  }

  error(message: string) {
    this.log('ERROR', message);
  }

  warn(message: string) {
    this.log('WARN', message);
  }

  getLogs(): string {
    return this.logs
      .map(l => `[${l.timestamp.toLocaleTimeString()}] ${l.level}: ${l.message}`)
      .join('\n');
  }

  clear() {
    this.logs = [];
  }
}

/**
 * 测试执行器
 */
export class TestExecutor {
  private logger = new LogManager();
  private monitor = new PerformanceMonitor();

  async runTest(
    testName: string,
    testFn: () => Promise<boolean>
  ): Promise<{ name: string; passed: boolean; duration: number; error?: string }> {
    this.logger.info(`开始: ${testName}`);
    this.monitor.start();

    try {
      const passed = await testFn();
      const duration = this.monitor.getDuration();

      if (passed) {
        this.logger.success(`完成: ${testName} (${duration.toFixed(2)}ms)`);
      } else {
        this.logger.error(`失败: ${testName}`);
      }

      return { name: testName, passed, duration };
    } catch (error) {
      const duration = this.monitor.getDuration();
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`异常: ${testName} - ${errorMsg}`);

      return {
        name: testName,
        passed: false,
        duration,
        error: errorMsg
      };
    }
  }

  async runTests(
    tests: Array<{ name: string; fn: () => Promise<boolean> }>
  ): Promise<Array<{ name: string; passed: boolean; duration: number; error?: string }>> {
    const results: Array<{ name: string; passed: boolean; duration: number; error?: string }> = [];

    for (const test of tests) {
      const result = await this.runTest(test.name, test.fn);
      results.push(result);
    }

    return results;
  }

  getReport(): string {
    const logLines = this.logger.getLogs().split('\n').filter((line) => line.trim().length > 0);
    const totalTests = logLines.length;
    return `
=== 测试报告 ===
总测试数: ${totalTests}
日志:
${this.logger.getLogs()}
    `;
  }
}

/**
 * 导出工具
 */
export const TestUtils = {
  MockData,
  TestScenarios,
  PerformanceMonitor,
  TestDataGenerator,
  ResultValidator,
  LogManager,
  TestExecutor
};
