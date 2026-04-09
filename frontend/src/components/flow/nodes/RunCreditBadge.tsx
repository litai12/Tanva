import React from "react";
import { useLocaleText } from "@/utils/localeText";

type RunCreditBadgeProps = {
  credits?: number;
  compact?: boolean;
  inline?: boolean;
};

export default function RunCreditBadge({
  credits,
  compact = false,
  inline = false,
}: RunCreditBadgeProps) {
  const { lt } = useLocaleText();
  const value = Number(credits);

  if (!Number.isFinite(value) || value <= 0) {
    return null;
  }

  if (inline) {
    return (
      <span
        title={lt("本次运行消耗", "Credits per run")}
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

  return (
    <span
      title={lt("本次运行消耗", "Credits per run")}
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
