import React from "react";
import GenericVideoNode from "./GenericVideoNode";

type Props = Omit<React.ComponentProps<typeof GenericVideoNode>, "data"> & {
  data: Omit<React.ComponentProps<typeof GenericVideoNode>["data"], "provider"> & {
    duration?: number;
    provider?: string;
  };
};

// Use the same controls, preview, history and actions as Seedance.
// Older Wan3.0 nodes stored duration; new controls write clipDuration.
function Wan30VideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(() => ({
    ...data,
    provider: "wan30" as const,
    managedModelKey: "wan-3.0",
    vendorKey: "new_api",
    platformKey: "new_api",
    clipDuration: data.clipDuration ?? data.duration ?? 5,
    resolution: data.resolution ?? "480P",
    aspectRatio: "adaptive",
  }), [data]);
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
}

export default React.memo(Wan30VideoNode);
