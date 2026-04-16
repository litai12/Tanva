import React from "react";

export type FlowRenderMode = {
  lowDetailMode: boolean;
};

const DEFAULT_FLOW_RENDER_MODE: FlowRenderMode = {
  lowDetailMode: false,
};

const FlowRenderModeContext = React.createContext<FlowRenderMode>(
  DEFAULT_FLOW_RENDER_MODE
);

export function FlowRenderModeProvider({
  value,
  children,
}: {
  value: FlowRenderMode;
  children: React.ReactNode;
}) {
  return (
    <FlowRenderModeContext.Provider value={value}>
      {children}
    </FlowRenderModeContext.Provider>
  );
}

export function useFlowRenderMode(): FlowRenderMode {
  return React.useContext(FlowRenderModeContext);
}
