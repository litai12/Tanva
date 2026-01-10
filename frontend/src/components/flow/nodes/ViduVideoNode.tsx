import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function ViduVideoNode({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'vidu' as VideoProvider }} selected={selected} />;
}

export default ViduVideoNode;
