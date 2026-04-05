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
        provider: "kling" as VideoProvider,
        klingModel: data?.klingModel || "kling-v3-0",
      }}
      selected={selected}
    />
  );
}

export default Kling30VideoNode;
