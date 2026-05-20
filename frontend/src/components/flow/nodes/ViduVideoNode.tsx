import React from 'react';
import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = { id: string; data: any; selected?: boolean };

const ViduVideoNode = React.memo(function ViduVideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(() => ({ ...data, provider: 'vidu' as VideoProvider }), [data]);
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
});

export default ViduVideoNode;
