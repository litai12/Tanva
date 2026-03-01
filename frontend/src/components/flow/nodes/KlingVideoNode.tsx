import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function KlingVideoNode({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'kling' as VideoProvider }} selected={selected} />;
}

export default KlingVideoNode;
