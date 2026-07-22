"use client";

import { createContext, useContext, useEffect, useState } from "react";

type Language = "en" | "zh";

type Copy = {
  product: string;
  docs: string;
  plugins: string;
  github: string;
  nominate: string;
  search: string;
  all: string;
  language: string;
};

const copy: Record<Language, Copy> = {
  en: { product: "Product", docs: "Docs", plugins: "Plugins", github: "GitHub", nominate: "Nominate a plugin", search: "Search plugins", all: "All plugins", language: "中文" },
  zh: { product: "产品", docs: "文档", plugins: "插件", github: "GitHub", nominate: "提名插件", search: "搜索插件", all: "全部插件", language: "EN" },
};

const LanguageContext = createContext<{
  language: Language;
  copy: Copy;
  toggleLanguage: () => void;
}>({ language: "en", copy: copy.en, toggleLanguage: () => undefined });

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem("turboism-interface-language");
    const nextLanguage =
      saved === "en" || saved === "zh"
        ? saved
        : navigator.language.toLowerCase().startsWith("zh")
          ? "zh"
          : "en";
    const timer = window.setTimeout(() => setLanguage(nextLanguage), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function toggleLanguage() {
    const nextLanguage = language === "en" ? "zh" : "en";
    window.localStorage.setItem("turboism-interface-language", nextLanguage);
    setLanguage(nextLanguage);
  }

  return <LanguageContext.Provider value={{ language, copy: copy[language], toggleLanguage }}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
