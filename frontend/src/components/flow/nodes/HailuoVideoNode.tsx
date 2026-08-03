import React from "react";
import GenericVideoNode, { type VideoProvider } from "./GenericVideoNode";

type Props = { id: string; data: any; selected?: boolean };

const HailuoVideoNode = React.memo(function HailuoVideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(
    () => ({
      ...data,
      provider: "hailuo" as VideoProvider,
      hailuoModel: data?.hailuoModel || "h3",
      managedModelKey: "hailuo-h3",
      vendorKey: "new_api",
      platformKey: "new_api",
      channelTier: "default",
      channelSelectionExplicit: true,
      nodeConfigNameZh: data?.nodeConfigNameZh || "海螺 Hailuo",
      nodeConfigNameEn: data?.nodeConfigNameEn || "Hailuo",
    }),
    [data],
  );
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
});

export default HailuoVideoNode;
