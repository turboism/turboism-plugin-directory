"use client";
import { persistLanguagePreference, readLanguagePreference } from '@/brand/language-preference.mjs';

import { createContext, useContext, useEffect, useState } from "react";

export type Language = 'en' | 'zh' | 'ja' | 'ko';

const LANGUAGE_STORAGE_KEY = "turboism-interface-language";

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
  contact: string;
  report: string;
  nominate: string;
  request: string;
  search: string;
  all: string;
  language: string;
  filter: string;
  clearSearch: string;
  directoryLabel: string;
  tagsLabel: string;
  noMatchTitle: string;
  noMatchGuidance: string;
  emptyTitle: string;
  emptyExplanation: string;
  nominateQualifying: string;
  official: string;
  reviewed: string;
  toggleNavigation: string;
  selectLanguage: string;
};

const copy: Record<Language, Copy> = {
  ko: {"home":"홈","product":"제품","docs":"문서","sdk":"SDK","plugins":"플러그인","learn":"튜토리얼","chat":"채팅","download":"다운로드","github":"GitHub","contact":"문의","report":"문제 신고","nominate":"서드파티 플러그인 추천","request":"플러그인 요청","search":"플러그인 검색","all":"모든 플러그인","language":"한국어","filter":"필터","clearSearch":"검색 지우기","directoryLabel":"플러그인 디렉터리","tagsLabel":"플러그인 태그","noMatchTitle":"일치하는 플러그인이 없습니다.","noMatchGuidance":"다른 검색어를 입력하거나 필터를 해제해 보세요.","emptyTitle":"아직 등록된 플러그인이 없습니다.","emptyExplanation":"디렉터리는 공개되어 있으며 등록 조건을 충족하는 첫 릴리스를 기다리고 있습니다. 계획 중이거나 사용할 수 없는 플러그인을 임시로 등록하지 않습니다.","nominateQualifying":"등록 조건을 충족하는 서드파티 플러그인 추천","official":"공식","reviewed":"검토된 서드파티","toggleNavigation":"탐색 메뉴 열기 및 닫기","selectLanguage":"언어 선택"},

  en: { home: "Home", product: "Product", docs: "Docs", sdk: "SDK", plugins: "Plugins", learn: "Learn", chat: "Chat", download: "Download", github: "GitHub", contact: "Contact", report: "Report an issue", nominate: "Nominate a third-party plugin", request: "Plugin request", search: "Search plugins", all: "All plugins", language: "English", filter: "Filter", clearSearch: "Clear search", directoryLabel: "Plugin directory", tagsLabel: "Plugin tags", noMatchTitle: "No matching plugins.", noMatchGuidance: "Try another search or remove the filter.", emptyTitle: "No plugins listed yet.", emptyExplanation: "The directory is live before its first qualifying release. We will not fill it with planned or unavailable placeholders.", nominateQualifying: "Nominate a qualifying third-party plugin", official: "Official", reviewed: "Reviewed third-party", toggleNavigation: "Toggle navigation", selectLanguage: "Select language" },
  zh: { home: "首页", product: "产品", docs: "文档", sdk: "SDK", plugins: "插件", learn: "学习", chat: "聊天", download: "下载", github: "GitHub", contact: "联系我们", report: "反馈目录问题", nominate: "提名第三方插件", request: "插件请求", search: "搜索插件", all: "全部插件", language: "简体中文", filter: "筛选", clearSearch: "清除搜索", directoryLabel: "插件目录", tagsLabel: "插件标签", noMatchTitle: "没有匹配的插件。", noMatchGuidance: "请尝试其他关键词或清除筛选条件。", emptyTitle: "暂无已收录插件。", emptyExplanation: "目录已上线，正在等待首个符合收录条件的正式版本。我们不会用计划中或尚不可用的占位插件填充目录。", nominateQualifying: "提名符合条件的第三方插件", official: "官方", reviewed: "已审核的第三方插件", toggleNavigation: "切换导航", selectLanguage: "选择语言" },
  ja: { home: "ホーム", product: "プロダクト", docs: "ドキュメント", sdk: "SDK", plugins: "プラグイン", learn: "学ぶ", chat: "チャット", download: "ダウンロード", github: "GitHub", contact: "お問い合わせ", report: "問題を報告", nominate: "サードパーティプラグインを推薦", request: "プラグインをリクエスト", search: "プラグインを検索", all: "すべてのプラグイン", language: "日本語", filter: "絞り込み", clearSearch: "検索をクリア", directoryLabel: "プラグインディレクトリ", tagsLabel: "プラグインタグ", noMatchTitle: "一致するプラグインはありません。", noMatchGuidance: "別のキーワードを試すか、フィルターを解除してください。", emptyTitle: "掲載中のプラグインはまだありません。", emptyExplanation: "ディレクトリは公開されていますが、掲載条件を満たす最初のリリースを待っています。予定段階または利用できないプラグインで埋めることはありません。", nominateQualifying: "条件を満たすサードパーティプラグインを推薦", official: "公式", reviewed: "審査済みサードパーティ", toggleNavigation: "ナビゲーションを切り替える", selectLanguage: "言語を選択" },
};

const LanguageContext = createContext<{
  language: Language;
  copy: Copy;
  setLanguage: (language: Language) => void;
}>({ language: "en", copy: copy.en, setLanguage: () => undefined });

const isLanguage = (value: string | null | undefined): value is Language =>
  value === "en" || value === "zh" || value === "ja" || value === "ko";

function readLanguageCookie(): Language | null {
  return readLanguagePreference();
}

function persistLanguage(language: Language) {
  persistLanguagePreference(language);
}

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>("en");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      // Continue with the shared cookie or browser language.
    }

    const nextLanguage = readLanguageCookie()
      ?? (isLanguage(saved) ? saved : null)
      ?? (navigator.language.toLowerCase().startsWith("zh")
        ? "zh"
        : navigator.language.toLowerCase().startsWith("ja")
          ? "ja"
          : "en");
    persistLanguage(nextLanguage);
    const timer = window.setTimeout(() => setLanguage(nextLanguage), 0);
    const update = () => { const selected = readLanguagePreference(); if (selected) setLanguage(selected); };
    window.addEventListener('turboism:language', update);
    window.addEventListener('storage', update);
    window.addEventListener('pageshow', update);
    return () => { window.clearTimeout(timer); window.removeEventListener('turboism:language', update); window.removeEventListener('storage', update); window.removeEventListener('pageshow', update); };
  }, []);

  function changeLanguage(nextLanguage: Language) {
    persistLanguage(nextLanguage);
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
