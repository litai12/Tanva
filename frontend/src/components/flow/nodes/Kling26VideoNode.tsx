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
        klingModel: data?.klingModel || "kling-v2-6",
      }}
      selected={selected}
    />
  );
}

export default Kling26VideoNode;
