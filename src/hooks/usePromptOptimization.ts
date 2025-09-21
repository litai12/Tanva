import { useCallback, useState } from 'react';
import promptOptimizationService, {
  type PromptOptimizationRequest,
  type PromptOptimizationResult
} from '@/services/promptOptimizationService';
import type { AIError } from '@/types/ai';

interface UsePromptOptimization {
  optimize: (request: PromptOptimizationRequest) => Promise<PromptOptimizationResult | null>;
  loading: boolean;
  result: PromptOptimizationResult | null;
  error: AIError | null;
  reset: () => void;
}

export const usePromptOptimization = (): UsePromptOptimization => {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PromptOptimizationResult | null>(null);
  const [error, setError] = useState<AIError | null>(null);

  const optimize = useCallback(async (request: PromptOptimizationRequest) => {
    setLoading(true);
    setError(null);

    try {
      const response = await promptOptimizationService.optimizePrompt(request);

      if (response.success && response.data) {
        setResult(response.data);
        return response.data;
      }

      const fallbackError: AIError = response.error || {
        code: 'UNKNOWN_ERROR',
        message: '未知错误',
        timestamp: new Date()
      };

      setError(fallbackError);
      setResult(null);
      return null;
    } catch (err) {
      const fallbackError: AIError = {
        code: 'UNEXPECTED_EXCEPTION',
        message: err instanceof Error ? err.message : 'Unexpected error',
        details: err,
        timestamp: new Date()
      };
      setError(fallbackError);
      setResult(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return { optimize, loading, result, error, reset };
};

export default usePromptOptimization;
