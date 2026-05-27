import React from 'react';
import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = { id: string; data: any; selected?: boolean };

const ViduQ3ProVideoNode = React.memo(function ViduQ3ProVideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(() => ({ ...data, provider: 'viduq3-pro' as VideoProvider }), [data]);
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
});

export default ViduQ3ProVideoNode;
