import { Injectable, Logger } from '@nestjs/common';

/**
 * AI 调用成本计算器
 * 支持多提供商的成本计算
 */
@Injectable()
export class CostCalculatorService {
  private readonly logger = new Logger(CostCalculatorService.name);

  /**
   * 成本定价信息 (单位: 美元)
   */
  private readonly costMap: Record<string, Record<string, number>> = {
    gemini: {
      imageGeneration: 0.0129, // 每张图像 1,290 tokens @ $30/M tokens
      imageEditing: 0.0258,
      imageBlending: 0.0387,
      imageAnalysis: 0.0065,
      textChat: 0.00005, // 低成本文本
    },
    openai: {
      imageGeneration: 0.04, // DALL-E 3: $0.04 per image
      imageEditing: 0.08,
      imageBlending: 0.12,
      imageAnalysis: 0.01,
      textChat: 0.015, // GPT-4 Vision: $0.01/1K input + $0.03/1K output
    },
    claude: {
      imageGeneration: 0.03,
      imageEditing: 0.06,
      imageBlending: 0.09,
      imageAnalysis: 0.008,
      textChat: 0.012, // Claude 3: $0.003/1K input + $0.015/1K output
    },
    'stable-diffusion': {
      imageGeneration: 0.01,
      imageEditing: 0.015,
      imageBlending: 0.025,
      imageAnalysis: 0,
      textChat: 0,
    },
    runninghub: {
      imageGeneration: 0.03,
      imageEditing: 0.03,
      imageBlending: 0.035,
      imageAnalysis: 0,
      textChat: 0,
    },
    midjourney: {
      imageGeneration: 0.06,
      imageEditing: 0.06,
      imageBlending: 0.065,
      imageAnalysis: 0.02,
      textChat: 0,
    },
  };

  /**
   * 计算单次 API 调用的成本
   */
  calculateCost(provider: string, operation: string): number {
    const providerKey = provider.toLowerCase();
    const providerCosts = this.costMap[providerKey];

    if (!providerCosts) {
      this.logger.warn(`Unknown provider: ${provider}, using gemini as default`);
      return this.costMap.gemini[operation] || 0;
    }

    return providerCosts[operation] || 0;
  }

  /**
   * 计算批量操作的总成本
   */
  calculateBatchCost(
    provider: string,
    operations: Array<{ operation: string; count: number }>
  ): number {
    let totalCost = 0;

    for (const item of operations) {
      totalCost += this.calculateCost(provider, item.operation) * item.count;
    }

    return totalCost;
  }

  /**
   * 获取所有支持的提供商
   */
  getSupportedProviders(): string[] {
    return Object.keys(this.costMap);
  }

  /**
   * 获取提供商的所有操作定价
   */
  getProviderPricing(provider: string): Record<string, number> | null {
    return this.costMap[provider.toLowerCase()] || null;
  }

  /**
   * 比较不同提供商的成本
   */
  compareCosts(
    operation: string,
    count: number = 1
  ): Array<{ provider: string; cost: number }> {
    const comparison = [];

    for (const provider of this.getSupportedProviders()) {
      const costPerOperation = this.calculateCost(provider, operation);
      comparison.push({
        provider,
        cost: costPerOperation * count,
      });
    }

    // 按成本排序
    comparison.sort((a, b) => a.cost - b.cost);
    return comparison;
  }

  /**
   * 生成成本报告
   */
  generateCostReport(
    provider: string,
    stats: {
      imageGenerations: number;
      imageEdits: number;
      imageBlends: number;
      imageAnalyses: number;
      textChats: number;
    }
  ): any {
    const costs: Record<string, number> = {
      imageGenerations: this.calculateCost(provider, 'imageGeneration') * stats.imageGenerations,
      imageEdits: this.calculateCost(provider, 'imageEditing') * stats.imageEdits,
      imageBlends: this.calculateCost(provider, 'imageBlending') * stats.imageBlends,
      imageAnalyses: this.calculateCost(provider, 'imageAnalysis') * stats.imageAnalyses,
      textChats: this.calculateCost(provider, 'textChat') * stats.textChats,
    };

    const totalCost = Object.values(costs).reduce((a: number, b: number) => a + b, 0);

    return {
      provider,
      period: new Date().toISOString(),
      operationCosts: costs,
      operationCounts: stats,
      totalCost: parseFloat(totalCost.toFixed(4)),
      breakdown: this.getBreakdown(costs, totalCost),
    };
  }

  /**
   * 获取成本分布信息
   */
  private getBreakdown(costs: Record<string, number>, total: number): Record<string, any> {
    const breakdown: Record<string, any> = {};

    for (const [key, cost] of Object.entries(costs)) {
      breakdown[key] = {
        cost,
        percentage: total > 0 ? parseFloat(((cost / total) * 100).toFixed(2)) : 0,
      };
    }

    return breakdown;
  }

  /**
   * 估算成本上限
   */
  estimateBudget(provider: string, dailyBudget: number): any {
    const pricing = this.getProviderPricing(provider);

    if (!pricing) {
      throw new Error(`Unknown provider: ${provider}`);
    }

    // 简单估算：基于图像生成成本计算每天可生成的最大数量
    const costPerImage = pricing.imageGeneration;
    const maxImagesPerDay = Math.floor(dailyBudget / costPerImage);

    return {
      provider,
      dailyBudget,
      costPerImage,
      maxImagesPerDay,
      recommendation: `With $${dailyBudget} daily budget, you can generate approximately ${maxImagesPerDay} images using ${provider}`,
    };
  }
}
