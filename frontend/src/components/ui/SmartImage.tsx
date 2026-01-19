import React from "react";
import { useNonBase64ImageSrc } from "@/hooks/useNonBase64ImageSrc";

export type SmartImageProps = Omit<
  React.ImgHTMLAttributes<HTMLImageElement>,
  "src"
> & {
  src?: string | null;
  placeholder?: React.ReactNode;
};

const SmartImage = React.forwardRef<HTMLImageElement, SmartImageProps>(
  ({ src, placeholder, ...imgProps }, ref) => {
    const resolvedSrc = useNonBase64ImageSrc(src);
    if (!resolvedSrc) {
      if (placeholder !== undefined) {
        return <>{placeholder}</>;
      }
      // 默认占位：复用 className/style 保持布局稳定
      return (
        <div
          className={typeof imgProps.className === "string" ? imgProps.className : undefined}
          style={imgProps.style as React.CSSProperties | undefined}
        />
      );
    }
    return <img ref={ref} {...imgProps} src={resolvedSrc} />;
  }
);

SmartImage.displayName = "SmartImage";

export default SmartImage;
