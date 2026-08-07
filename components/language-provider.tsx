"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type Language = "en" | "zh" | "ja";

type Copy = {
  home: string;
  product: string;
  docs: string;
  sdk: string;
  plugins: string;
  learn: string;
  chat: string;
  download: string;
  github: string;
  nominate: string;
  search: string;
  all: string;
  language: string;
};

const copy: Record<Language, Copy> = {
  en: { home: "Home", product: "Product", docs: "Docs", sdk: "SDK", plugins: "Plugins", learn: "Learn", chat: "Chat", download: "Download", github: "GitHub", nominate: "Nominate a plugin", search: "Search plugins", all: "All plugins", language: "English" },
  zh: { home: "首页", product: "产品", docs: "文档", sdk: "SDK", plugins: "插件", learn: "学习", chat: "聊天", download: "下载", github: "GitHub", nominate: "提名插件", search: "搜索插件", all: "全部插件", language: "简体中文" },
  ja: { home: "ホーム", product: "プロダクト", docs: "ドキュメント", sdk: "SDK", plugins: "プラグイン", learn: "学ぶ", chat: "チャット", download: "ダウンロード", github: "GitHub", nominate: "プラグインを推薦", search: "プラグインを検索", all: "すべてのプラグイン", language: "日本語" },
};

const LanguageContext = createContext<{
  language: Language;
  copy: Copy;
  setLanguage: (language: Language) => void;
}>({ language: "en", copy: copy.en, setLanguage: () => undefined });

const isLanguage = (value: string | null): value is Language =>
  value === "en" || value === "zh" || value === "ja";

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    const saved = window.localStorage.getItem("turboism-interface-language");
    const nextLanguage = isLanguage(saved)
      ? saved
      : navigator.language.toLowerCase().startsWith("zh")
        ? "zh"
        : navigator.language.toLowerCase().startsWith("ja")
          ? "ja"
          : "en";
    const timer = window.setTimeout(() => setLanguage(nextLanguage), 0);
    return () => window.clearTimeout(timer);
  }, []);

  function changeLanguage(nextLanguage: Language) {
    window.localStorage.setItem("turboism-interface-language", nextLanguage);
    setLanguage(nextLanguage);
  }

  return (
    <LanguageContext.Provider value={{ language, copy: copy[language], setLanguage: changeLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
