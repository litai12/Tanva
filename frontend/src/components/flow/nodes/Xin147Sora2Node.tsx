import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function Xin147Sora2Node({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'xin147-sora2' as VideoProvider }} selected={selected} />;
}

export default Xin147Sora2Node;
