import React from "react";
import { RefreshCw, TriangleAlert } from "lucide-react";
import { reportReactRenderError } from "@/bootstrap/runtimeStability";

type BoundaryProps = {
  children: React.ReactNode;
  nodeId?: string;
  nodeType: string;
};

type BoundaryState = {
  error: Error | null;
};

class FlowNodeErrorBoundary extends React.Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    const nodeId = this.props.nodeId || "unknown";
    console.error("[FlowNodeErrorBoundary] node render failed", {
      nodeId,
      nodeType: this.props.nodeType,
      error,
      componentStack: info.componentStack,
    });
    reportReactRenderError({
      error,
      label: `工作流节点:${this.props.nodeType}`,
      componentStack: info.componentStack,
      context: {
        boundaryVariant: "flow-node",
        flowNodeId: nodeId,
        flowNodeType: this.props.nodeType,
      },
    });
  }

  private retry = (): void => {
    this.setState({ error: null });
  };

  render(): React.ReactNode {
    if (!this.state.error) return this.props.children;

    return (
      <div className="nodrag nowheel flex min-h-[116px] min-w-[220px] flex-col items-center justify-center gap-2 rounded-lg border border-red-200 bg-white px-4 py-3 text-center text-slate-700 shadow-sm">
        <TriangleAlert className="h-5 w-5 text-red-500" />
        <div className="text-sm font-medium">此节点暂时无法显示</div>
        <div className="max-w-[260px] truncate text-[11px] text-slate-400">
          {this.props.nodeType} · {this.props.nodeId || "unknown"}
        </div>
        <button
          type="button"
          onClick={this.retry}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-slate-900 px-2.5 text-xs font-medium text-white hover:bg-slate-700"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          重试节点
        </button>
      </div>
    );
  }
}

export function guardFlowNodeTypes<
  T extends Record<string, React.ElementType>,
>(nodeTypes: T): T {
  return Object.fromEntries(
    Object.entries(nodeTypes).map(([nodeType, NodeComponent]) => {
      const RenderNode = NodeComponent as React.ComponentType<
        Record<string, unknown>
      >;
      const GuardedNode = (props: Record<string, unknown>) => {
        return (
          <FlowNodeErrorBoundary
            nodeId={typeof props.id === "string" ? props.id : undefined}
            nodeType={nodeType}
          >
            <RenderNode {...props} />
          </FlowNodeErrorBoundary>
        );
      };
      GuardedNode.displayName = `GuardedFlowNode(${nodeType})`;
      return [nodeType, React.memo(GuardedNode)];
    }),
  ) as unknown as T;
}
