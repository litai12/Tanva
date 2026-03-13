import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function ViduQ3ProVideoNode({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'viduq3-pro' as VideoProvider }} selected={selected} />;
}

export default ViduQ3ProVideoNode;
