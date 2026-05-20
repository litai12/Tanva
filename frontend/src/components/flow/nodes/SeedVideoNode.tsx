import React from 'react';
import GenericVideoNode, { type VideoProvider } from './GenericVideoNode';

type Props = { id: string; data: any; selected?: boolean };

const SeedVideoNode = React.memo(function SeedVideoNode({ id, data, selected }: Props) {
  const merged = React.useMemo(() => ({
    ...data,
    provider: 'doubao' as VideoProvider,
    seedFamily: 'seed2',
    seedanceModel: data?.seedanceModel || 'seed-2.0-lite',
    seedanceMode: data?.seedanceMode || 'reference_images',
    clipDuration: data?.clipDuration || 5,
    resolution: data?.resolution || '720P',
    generateAudio: typeof data?.generateAudio === 'boolean' ? data.generateAudio : true,
  }), [data]);
  return <GenericVideoNode id={id} data={merged} selected={selected} />;
});

export default SeedVideoNode;
