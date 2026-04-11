import React from "react";
import { useNavigate } from "react-router-dom";
import { useAIChatStore } from "@/stores/aiChatStore";
import { cn } from "@/lib/utils";
import MembershipPanel from "@/components/payment/MembershipPanel";

/**
 * 独立路由页：VIP 订阅（原弹窗改为整页，供 /my-credits 等入口跳转）
 */
const MembershipSubscribePage: React.FC = () => {
  const navigate = useNavigate();
  const isWhite = useAIChatStore((s) => s.chatTheme === "white");

  return (
    <div
      className={cn(
        "flex h-dvh min-h-0 flex-col",
        isWhite ? "bg-white" : "bg-zinc-950 text-zinc-100",
      )}
    >
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-y-contain",
          isWhite && "min-h-full bg-white",
        )}
      >
        <div
          className={cn(
            "mx-auto w-full max-w-[min(100%,1920px)] px-3 py-4 pb-10 sm:px-4 sm:py-6 sm:pb-12 md:px-5 lg:px-6 xl:px-8 2xl:px-10",
            isWhite && "min-h-full bg-white",
          )}
        >
          <MembershipPanel
            hideBackButton
            onBack={() => navigate(-1)}
            onPaymentSuccess={() => {
              window.dispatchEvent(new CustomEvent("refresh-credits"));
              void navigate("/my-credits", { replace: true });
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default MembershipSubscribePage;
