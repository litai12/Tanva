import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function KlingVideoNode({ id, data, selected }: Props) {
  return (
    <GenericVideoNode
      id={id}
      data={{
        ...data,
        provider: "kling" as VideoProvider,
        creditsPerCall:
          typeof data?.creditsPerCall === "number" ? data.creditsPerCall : 600,
        nodeConfigNameZh: data?.nodeConfigNameZh || "Kling视频生成",
        nodeConfigNameEn: data?.nodeConfigNameEn || "Kling",
        klingModel: data?.klingModel || "kling-v2-1",
      }}
      selected={selected}
    />
  );
}

export default KlingVideoNode;
