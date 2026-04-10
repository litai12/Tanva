import GenericVideoNode, { type VideoProvider } from "./GenericVideoNode";

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function Seedance20VideoNode({ id, data, selected }: Props) {
  return (
    <GenericVideoNode
      id={id}
      data={{
        ...data,
        provider: "doubao" as VideoProvider,
        seedanceModel: data?.seedanceModel || "seedance-2.0",
        seedanceMode: data?.seedanceMode || "text",
        clipDuration: data?.clipDuration || 5,
        resolution: data?.resolution || "720P",
        generateAudio: typeof data?.generateAudio === "boolean" ? data.generateAudio : false,
      }}
      selected={selected}
    />
  );
}

export default Seedance20VideoNode;
