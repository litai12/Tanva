import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft } from "lucide-react";
import { useAIChatStore } from "@/stores/aiChatStore";
import { cn } from "@/lib/utils";
import MembershipPanel from "@/components/payment/MembershipPanel";

/**
 * 独立路由页：VIP 订阅（原弹窗改为整页，供 /my-credits 等入口跳转）
 */
const MembershipSubscribePage: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const returnTo = searchParams.get("returnTo");
  const mobileReturnTo = returnTo && /^\/m(?:\/|\?|$)/.test(returnTo) ? returnTo : null;
  const handleBack = () => {
    if (mobileReturnTo) {
      navigate(mobileReturnTo, { replace: true });
      return;
    }
    if (window.history.state?.idx > 0) {
      navigate(-1);
      return;
    }
    navigate("/m", { replace: true });
  };
  const isWhite = useAIChatStore((s) => s.chatTheme === "white");

  return (
    <div
      className={cn(
        "flex h-dvh min-h-0 flex-col",
        isWhite ? "bg-white" : "bg-zinc-950 text-zinc-100",
      )}
    >
      <div className={cn("shrink-0 border-b px-3 py-2 sm:px-4", isWhite ? "border-slate-200" : "border-zinc-800")}>
        <button type="button" onClick={handleBack}
          className={cn("inline-flex h-11 items-center gap-1 rounded-full px-3 text-sm", isWhite ? "text-slate-700 hover:bg-slate-100" : "text-zinc-100 hover:bg-zinc-800")}>
          <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          <span>{t("common.actions.back")}</span>
        </button>
      </div>
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
            onBack={handleBack}
            onPaymentSuccess={() => {
              window.dispatchEvent(new CustomEvent("refresh-credits"));
              void navigate(mobileReturnTo ? `/my-credits?returnTo=${encodeURIComponent(mobileReturnTo)}` : "/my-credits", { replace: true });
            }}
          />
        </div>
      </div>
    </div>
  );
};

export default MembershipSubscribePage;
