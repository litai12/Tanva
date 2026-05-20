import React from 'react';
import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = { id: string; data: any; selected?: boolean };

const Kling30VideoNode = React.memo(function Kling30VideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(() => ({
    ...data,
    provider: 'kling-o3' as VideoProvider,
    creditsPerCall: typeof data?.creditsPerCall === 'number' ? data.creditsPerCall : 600,
    nodeConfigNameZh: data?.nodeConfigNameZh || 'Kling 3.0',
    nodeConfigNameEn: data?.nodeConfigNameEn || 'Kling 3.0',
    klingModel: data?.klingModel || 'kling-v3-0',
  }), [data]);
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
});

export default Kling30VideoNode;
