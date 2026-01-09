import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function ZhenzhenSora2Node({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'zhenzhen-sora2' as VideoProvider }} selected={selected} />;
}

export default ZhenzhenSora2Node;
