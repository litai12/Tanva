import React from "react";
import i18n from "@/i18n";
import { useTranslation } from "react-i18next";

export const isZhLanguage = (language?: string | null): boolean => {
  const value = String(language || "").toLowerCase();
  return value.startsWith("zh");
};

export const pickLocaleText = (
  zhText: string,
  enText: string,
  language?: string | null
): string => {
  const current = language ?? i18n.resolvedLanguage ?? i18n.language;
  return isZhLanguage(current) ? zhText : enText;
};

export const useLocaleText = () => {
  const { i18n: i18nInstance } = useTranslation();
  const language = i18nInstance.resolvedLanguage || i18nInstance.language;
  const isZh = isZhLanguage(language);

  const lt = React.useCallback(
    (zhText: string, enText: string) => (isZh ? zhText : enText),
    [isZh]
  );

  return { language, isZh, lt };
};
