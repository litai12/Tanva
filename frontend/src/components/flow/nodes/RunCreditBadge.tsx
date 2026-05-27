import React from "react";
import { useLocaleText } from "@/utils/localeText";
import { Star } from "lucide-react";
import { useNodeRunCredits } from "../hooks/useNodeRunCredits";

type RunCreditBadgeProps = {
  credits?: number;
  compact?: boolean;
  inline?: boolean;
  runButton?: boolean;
  className?: string;
};

function RunCreditBadge({
  credits,
  compact = false,
  inline = false,
  runButton = false,
  className = "",
}: RunCreditBadgeProps) {
  const { lt } = useLocaleText();
  const { credits: resolvedCredits } = useNodeRunCredits(credits);
  const value = Number(resolvedCredits);
  const titleText = `${lt("Cost", "Cost")}: ${value} ${lt("credits", "credits")}`;

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (inline) {
    return (
      <span
        title={titleText}
        style={{
          color: "#6b7280",
          fontSize: compact ? 11 : 12,
          fontWeight: 500,
          lineHeight: 1,
          whiteSpace: "nowrap",
        }}
      >
        {" · "}
        {value}
      </span>
    );
  }

  if (runButton) {
    return (
      <span
        title={titleText}
        className={`run-credit-badge ${className}`.trim()}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 2,
          padding: "2px 5px",
          borderRadius: 4,
          background: "rgba(255,255,255,0.15)",
          border: "1px solid rgba(255,255,255,0.25)",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1,
          color: "#fef3c7",
          whiteSpace: "nowrap",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            position: "relative",
            display: "inline-flex",
            width: 12,
            height: 12,
            borderRadius: 999,
            alignItems: "center",
            justifyContent: "center",
            background: "linear-gradient(135deg, #fcd34d, #f59e0b, #f97316)",
            boxShadow: "0 1px 4px rgba(245,158,11,0.5)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              position: "absolute",
              inset: 1,
              borderRadius: 999,
              background: "linear-gradient(135deg, rgba(253,230,138,0.85), rgba(245,158,11,0.8))",
            }}
          />
          <Star
            style={{
              position: "relative",
              width: 7,
              height: 7,
              color: "#fffbeb",
              fill: "rgba(254,243,199,0.9)",
            }}
          />
        </span>
        {value}
      </span>
    );
  }

  return (
    <span
      title={titleText}
      className={`run-credit-badge ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        height: compact ? 20 : 22,
        padding: compact ? "0 6px" : "0 8px",
        borderRadius: 999,
        background: "#f3f4f6",
        border: "1px solid #e5e7eb",
        color: "#4b5563",
        fontSize: compact ? 10 : 11,
        fontWeight: 600,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {value}
    </span>
  );
}

export default React.memo(RunCreditBadge);
