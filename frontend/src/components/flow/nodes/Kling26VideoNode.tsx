import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function Kling26VideoNode({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'kling-2.6' as VideoProvider }} selected={selected} />;
}

export default Kling26VideoNode;
