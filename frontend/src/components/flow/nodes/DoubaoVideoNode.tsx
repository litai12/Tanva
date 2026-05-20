import React from 'react';
import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = { id: string; data: any; selected?: boolean };

const DoubaoVideoNode = React.memo(function DoubaoVideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(() => ({ ...data, provider: 'doubao' as VideoProvider }), [data]);
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
});

export default DoubaoVideoNode;
