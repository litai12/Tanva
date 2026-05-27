import React from 'react';
import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = { id: string; data: any; selected?: boolean };

const KlingVideoNode = React.memo(function KlingVideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(() => ({
    ...data,
    provider: 'kling' as VideoProvider,
    creditsPerCall: typeof data?.creditsPerCall === 'number' ? data.creditsPerCall : 600,
    nodeConfigNameZh: data?.nodeConfigNameZh || 'Kling',
    nodeConfigNameEn: data?.nodeConfigNameEn || 'Kling',
    klingModel: data?.klingModel || 'kling-v2-1',
  }), [data]);
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
});

export default KlingVideoNode;
