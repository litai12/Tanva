import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function ApiMartSora2Node({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'apimart-sora2' as VideoProvider }} selected={selected} />;
}

export default ApiMartSora2Node;
