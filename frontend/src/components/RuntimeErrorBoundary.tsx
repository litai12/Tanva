import React from "react";
import { RefreshCw } from "lucide-react";

type RuntimeErrorBoundaryProps = {
  children: React.ReactNode;
  label?: string;
  variant?: "root" | "panel";
  resetKeys?: readonly unknown[];
};

type RuntimeErrorBoundaryState = {
  error: Error | null;
};

const resetKeysChanged = (
  previous: readonly unknown[] | undefined,
  current: readonly unknown[] | undefined
): boolean => {
  if (previous === current) return false;
  if (!previous || !current || previous.length !== current.length) return true;
  return previous.some((value, index) => !Object.is(value, current[index]));
};

export default class RuntimeErrorBoundary extends React.Component<
  RuntimeErrorBoundaryProps,
  RuntimeErrorBoundaryState
> {
  state: RuntimeErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): RuntimeErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error("[RuntimeErrorBoundary] render failed", {
      label: this.props.label,
      error,
      componentStack: info.componentStack,
    });
  }

  componentDidUpdate(previousProps: RuntimeErrorBoundaryProps): void {
    if (
      this.state.error &&
      resetKeysChanged(previousProps.resetKeys, this.props.resetKeys)
    ) {
      this.setState({ error: null });
    }
  }

  private retry = (): void => {
    if (this.props.variant === "root") {
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    const label = this.props.label || "此区域";
    if (this.props.variant === "root") {
      return (
        <main className="flex min-h-screen items-center justify-center bg-white px-6 text-slate-900">
          <div className="max-w-md text-center">
            <h1 className="text-lg font-semibold">页面暂时无法显示</h1>
            <p className="mt-2 text-sm text-slate-600">
              页面遇到运行错误，刷新后可继续使用。
            </p>
            <button
              type="button"
              onClick={this.retry}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-slate-900 px-3 text-sm font-medium text-white hover:bg-slate-700"
            >
              <RefreshCw className="h-4 w-4" />
              刷新页面
            </button>
          </div>
        </main>
      );
    }

    return (
      <div className="pointer-events-auto absolute inset-x-0 top-4 z-[10020] flex justify-center px-4">
        <div className="flex items-center gap-3 rounded-md border border-red-200 bg-white px-3 py-2 text-sm text-slate-700 shadow-lg">
          <span>{label}加载失败</span>
          <button
            type="button"
            onClick={this.retry}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-700"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            重试
          </button>
        </div>
      </div>
    );
  }
}
