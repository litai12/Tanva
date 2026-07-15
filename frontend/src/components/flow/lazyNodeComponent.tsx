import React, { Suspense } from "react";

// 把重依赖节点(three/PPT模板等)拆出主包:首屏不下载,画布上出现该类型节点时才拉对应chunk
export function lazyNodeComponent<P extends object>(
  loader: () => Promise<{ default: React.ComponentType<P> }>,
): React.ComponentType<P> {
  const Lazy = React.lazy(loader);
  const Wrapped = (props: P) => (
    <Suspense fallback={null}>
      <Lazy {...(props as P & React.Attributes)} />
    </Suspense>
  );
  return React.memo(Wrapped) as unknown as React.ComponentType<P>;
}
