import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function Kling26VideoNode({ id, data, selected }: Props) {
  return (
    <GenericVideoNode
      id={id}
      data={{
        ...data,
        provider: "kling" as VideoProvider,
        creditsPerCall:
          typeof data?.creditsPerCall === "number" ? data.creditsPerCall : 600,
        nodeConfigNameZh: data?.nodeConfigNameZh || "Kling 2.6",
        nodeConfigNameEn: data?.nodeConfigNameEn || "Kling 2.6",
        klingModel: data?.klingModel || "kling-v2-6",
      }}
      selected={selected}
    />
  );
}

export default Kling26VideoNode;
