import GenericVideoNode, { type VideoProvider } from "./GenericVideoNode";

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function Kling30VideoNode({ id, data, selected }: Props) {
  return (
    <GenericVideoNode
      id={id}
      data={{
        ...data,
        provider: "kling-o3" as VideoProvider,
        creditsPerCall:
          typeof data?.creditsPerCall === "number" ? data.creditsPerCall : 600,
        nodeConfigNameZh: data?.nodeConfigNameZh || "Kling 3.0",
        nodeConfigNameEn: data?.nodeConfigNameEn || "Kling 3.0",
        klingModel: data?.klingModel || "kling-v3-0",
      }}
      selected={selected}
    />
  );
}

export default Kling30VideoNode;
