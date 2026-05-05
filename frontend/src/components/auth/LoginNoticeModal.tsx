import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getStoredLastAuthAt } from "@/services/authApi";
import { getLoginNotice, type LoginNotice } from "@/services/loginNoticeApi";
import { useAuthStore } from "@/stores/authStore";
import { useLocaleText } from "@/utils/localeText";

const DISMISSED_KEY_PREFIX = "tanva:login-notice:dismissed";

const buildDismissedKey = (
  userId: string,
  authAt: number,
  noticeUpdatedAt: string | null
) => `${DISMISSED_KEY_PREFIX}:${userId}:${authAt}:${noticeUpdatedAt || "none"}`;

const isDismissed = (key: string) => {
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
};

const markDismissed = (key: string) => {
  try {
    localStorage.setItem(key, "1");
  } catch {}
};

export default function LoginNoticeModal() {
  const user = useAuthStore((state) => state.user);
  const { lt } = useLocaleText();
  const [notice, setNotice] = useState<LoginNotice | null>(null);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNotice(null);
    setDismissedKey(null);
    setVisible(false);

    if (!user?.id) return;

    const authAt = getStoredLastAuthAt();
    if (!authAt) return;

    getLoginNotice()
      .then((nextNotice) => {
        if (cancelled) return;
        const content = nextNotice.content.trim();
        if (!nextNotice.enabled || !content) return;

        const nextDismissedKey = buildDismissedKey(
          user.id,
          authAt,
          nextNotice.updatedAt
        );
        if (isDismissed(nextDismissedKey)) return;

        setNotice(nextNotice);
        setDismissedKey(nextDismissedKey);
        setVisible(true);
      })
      .catch((error) => {
        if (!cancelled) {
          console.warn("Failed to load login notice:", error);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [user?.id]);

  if (!visible || !notice) return null;

  const handleClose = () => {
    if (dismissedKey) {
      markDismissed(dismissedKey);
    }
    setVisible(false);
  };

  return (
    <div
      className='fixed inset-0 z-[1600] flex items-center justify-center bg-transparent px-4 py-6'
      role='dialog'
      aria-modal='true'
      aria-labelledby='login-notice-title'
    >
      <div className='w-full max-w-lg overflow-hidden rounded-[28px] border border-liquid-glass bg-white/80 shadow-[0_24px_80px_rgba(15,23,42,0.16)] backdrop-blur-liquid backdrop-saturate-125'>
        <div className='flex items-center gap-3 border-b border-slate-200/60 px-6 py-5'>
          <div className='flex items-center gap-3'>
            <div className='flex h-10 w-10 items-center justify-center rounded-full border border-liquid-glass-light bg-white/70 text-slate-700 shadow-liquid-glass backdrop-blur-minimal'>
              <Bell className='h-4 w-4' />
            </div>
            <div>
              <h2 id='login-notice-title' className='text-base font-semibold text-slate-900'>
                {lt("用户提醒", "Notice")}
              </h2>
            </div>
          </div>
        </div>

        <div className='max-h-[56vh] overflow-y-auto px-6 py-6'>
          <div className='whitespace-pre-wrap break-words text-sm font-medium leading-7 text-slate-700'>
            {notice.content}
          </div>
        </div>

        <div className='flex justify-center border-t border-slate-200/60 bg-white/35 px-6 py-5'>
          <Button
            onClick={handleClose}
            className='h-10 min-w-[112px] rounded-xl border border-liquid-glass bg-white/75 text-slate-700 shadow-liquid-glass backdrop-blur-minimal hover:bg-white/90'
          >
            {lt("我知道了", "Got it")}
          </Button>
        </div>
      </div>
    </div>
  );
}
