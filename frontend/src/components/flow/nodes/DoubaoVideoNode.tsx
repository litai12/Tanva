import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

function DoubaoVideoNode({ id, data, selected }: Props) {
  return <GenericVideoNode id={id} data={{ ...data, provider: 'doubao' as VideoProvider }} selected={selected} />;
}

export default DoubaoVideoNode;
