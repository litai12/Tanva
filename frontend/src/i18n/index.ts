import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import zhCN from "./locales/zh-CN";
import enUS from "./locales/en-US";

export const SUPPORTED_LANGUAGES = ["zh-CN", "en-US"] as const;
export type AppLanguage = (typeof SUPPORTED_LANGUAGES)[number];

const resources = {
  "zh-CN": { translation: zhCN },
  "en-US": { translation: enUS },
};

const normalizeDetectedLanguage = (lng?: string): AppLanguage => {
  const value = String(lng || "").toLowerCase().trim();
  if (value.startsWith("en")) return "en-US";
  if (value.startsWith("zh")) return "zh-CN";
  return "zh-CN";
};

if (!i18n.isInitialized) {
  i18n
    .use(LanguageDetector)
    .use(initReactI18next)
    .init({
      resources,
      ns: ["translation"],
      defaultNS: "translation",
      fallbackLng: "zh-CN",
      supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
      nonExplicitSupportedLngs: false,
      load: "currentOnly",
      initImmediate: false,
      detection: {
        order: ["querystring", "localStorage", "navigator"],
        lookupQuerystring: "lang",
        lookupLocalStorage: "tanva-locale",
        caches: ["localStorage"],
        convertDetectedLanguage: normalizeDetectedLanguage,
      },
      interpolation: {
        escapeValue: false,
      },
      keySeparator: ".",
      nsSeparator: ":",
      ignoreJSONStructure: false,
      returnNull: false,
    });

  const normalized = normalizeDetectedLanguage(
    i18n.resolvedLanguage || i18n.language
  );
  if ((i18n.resolvedLanguage || i18n.language) !== normalized) {
    void i18n.changeLanguage(normalized);
  }
}

export default i18n;
