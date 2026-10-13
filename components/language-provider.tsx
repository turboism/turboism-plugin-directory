"use client";
import { persistLanguagePreference, readLanguagePreference } from "@/brand/language-preference.mjs";
import { normalizeCatalogLocale, type CatalogLocale } from "@/lib/directory-view.mjs";
import { createContext, useContext, useEffect, useState } from "react";

export type Language = "en" | "zh" | "ja" | "ko";

const LANGUAGE_STORAGE_KEY = "turboism-interface-language";

export type Copy = {
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
  categoriesLabel: string;
  allCategories: string;
  noMatchTitle: string;
  noMatchGuidance: string;
  emptyTitle: string;
  emptyExplanation: string;
  nominateQualifying: string;
  official: string;
  reviewed: string;
  toggleNavigation: string;
  selectLanguage: string;
  latestVersionLabel: string;
  cubismVersionsLabel: string;
  cubismIndependent: string;
  sha256Label: string;
  downloadJar: string;
  viewRelease: string;
  viewDetails: string;
  backToDirectory: string;
  maintainerLabel: string;
  licenseLabel: string;
  categoryLabel: string;
  channelLabel: string;
  turboismApiLabel: string;
  sourceLabel: string;
  openRepository: string;
  supportLabel: string;
  supportChannel: string;
  verifiedReleaseTitle: string;
  officialNotice: string;
  reviewedNotice: string;
  permissionsLabel: string;
  dependenciesLabel: string;
  categoryNames: Record<string, string>;
};

const copy: Record<Language, Copy> = {
  ko: {
    home: "홈",
    product: "제품",
    docs: "문서",
    sdk: "SDK",
    plugins: "플러그인",
    learn: "튜토리얼",
    chat: "채팅",
    download: "다운로드",
    github: "GitHub",
    contact: "문의",
    report: "문제 신고",
    nominate: "서드파티 플러그인 추천",
    request: "플러그인 요청",
    search: "플러그인 검색",
    all: "모든 플러그인",
    language: "한국어",
    filter: "필터",
    clearSearch: "검색 지우기",
    directoryLabel: "플러그인 디렉터리",
    tagsLabel: "플러그인 태그",
    categoriesLabel: "플러그인 카테고리",
    allCategories: "모든 카테고리",
    noMatchTitle: "일치하는 플러그인이 없습니다.",
    noMatchGuidance: "다른 검색어를 입력하거나 필터를 해제해 보세요.",
    emptyTitle: "아직 등록된 플러그인이 없습니다.",
    emptyExplanation:
      "디렉터리는 공개되어 있으며 등록 조건을 충족하는 첫 릴리스를 기다리고 있습니다. 계획 중이거나 사용할 수 없는 플러그인을 임시로 등록하지 않습니다.",
    nominateQualifying: "등록 조건을 충족하는 서드파티 플러그인 추천",
    official: "공식",
    reviewed: "검토된 서드파티",
    toggleNavigation: "탐색 메뉴 열기 및 닫기",
    selectLanguage: "언어 선택",
    latestVersionLabel: "최신 버전",
    cubismVersionsLabel: "지원 Cubism 버전",
    cubismIndependent: "Cubism 버전 무관",
    sha256Label: "SHA-256",
    downloadJar: "JAR 다운로드",
    viewRelease: "GitHub 릴리스",
    viewDetails: "상세 보기",
    backToDirectory: "디렉터리로 돌아가기",
    maintainerLabel: "메인테이너",
    licenseLabel: "라이선스",
    categoryLabel: "카테고리",
    channelLabel: "채널",
    turboismApiLabel: "Turboism API",
    sourceLabel: "소스 저장소",
    openRepository: "저장소 열기",
    supportLabel: "지원",
    supportChannel: "지원 채널",
    verifiedReleaseTitle: "서명된 카탈로그 릴리스",
    officialNotice: "Turboism 공식 릴리스 파이프라인을 통해 게시되었으며 서명된 v2 카탈로그에 바인딩되어 있습니다.",
    reviewedNotice:
      "검토된 서드파티 항목이며 Turboism 제작, 보안 인증 또는 지속적인 호환성 지원을 의미하지 않습니다.",
    permissionsLabel: "권한",
    dependenciesLabel: "의존성",
    categoryNames: {
      modeling: "모델링",
      workflow: "워크플로",
      appearance: "외관",
      analysis: "분석",
      performance: "성능",
      integration: "통합",
      system: "시스템",
      development: "개발",
    },
  },
  en: {
    home: "Home",
    product: "Product",
    docs: "Docs",
    sdk: "SDK",
    plugins: "Plugins",
    learn: "Learn",
    chat: "Chat",
    download: "Download",
    github: "GitHub",
    contact: "Contact",
    report: "Report an issue",
    nominate: "Nominate a third-party plugin",
    request: "Plugin request",
    search: "Search plugins",
    all: "All plugins",
    language: "English",
    filter: "Filter",
    clearSearch: "Clear search",
    directoryLabel: "Plugin directory",
    tagsLabel: "Plugin tags",
    categoriesLabel: "Plugin categories",
    allCategories: "All categories",
    noMatchTitle: "No matching plugins.",
    noMatchGuidance: "Try another search or remove the filter.",
    emptyTitle: "No plugins listed yet.",
    emptyExplanation:
      "The directory is live before its first qualifying release. We will not fill it with planned or unavailable placeholders.",
    nominateQualifying: "Nominate a qualifying third-party plugin",
    official: "Official",
    reviewed: "Reviewed third-party",
    toggleNavigation: "Toggle navigation",
    selectLanguage: "Select language",
    latestVersionLabel: "Latest version",
    cubismVersionsLabel: "Supported Cubism versions",
    cubismIndependent: "Editor-independent",
    sha256Label: "SHA-256",
    downloadJar: "Download JAR",
    viewRelease: "GitHub Release",
    viewDetails: "Details",
    backToDirectory: "Back to Directory",
    maintainerLabel: "Maintainer",
    licenseLabel: "License",
    categoryLabel: "Category",
    channelLabel: "Channel",
    turboismApiLabel: "Turboism API",
    sourceLabel: "Source",
    openRepository: "Open repository",
    supportLabel: "Support",
    supportChannel: "Support channel",
    verifiedReleaseTitle: "Signed catalog release",
    officialNotice: "Published through the official Turboism release pipeline and bound to the signed v2 catalog.",
    reviewedNotice:
      "Reviewed third-party listing. Does not imply Turboism authorship, security certification, or ongoing compatibility support.",
    permissionsLabel: "Permissions",
    dependenciesLabel: "Dependencies",
    categoryNames: {
      modeling: "Modeling",
      workflow: "Workflow",
      appearance: "Appearance",
      analysis: "Analysis",
      performance: "Performance",
      integration: "Integration",
      system: "System",
      development: "Development",
    },
  },
  zh: {
    home: "首页",
    product: "产品",
    docs: "文档",
    sdk: "SDK",
    plugins: "插件",
    learn: "学习",
    chat: "聊天",
    download: "下载",
    github: "GitHub",
    contact: "联系我们",
    report: "反馈目录问题",
    nominate: "提名第三方插件",
    request: "插件请求",
    search: "搜索插件",
    all: "全部插件",
    language: "简体中文",
    filter: "筛选",
    clearSearch: "清除搜索",
    directoryLabel: "插件目录",
    tagsLabel: "插件标签",
    categoriesLabel: "插件分类",
    allCategories: "全部分类",
    noMatchTitle: "没有匹配的插件。",
    noMatchGuidance: "请尝试其他关键词或清除筛选条件。",
    emptyTitle: "暂无已收录插件。",
    emptyExplanation:
      "目录已上线，正在等待首个符合收录条件的正式版本。我们不会用计划中或尚不可用的占位插件填充目录。",
    nominateQualifying: "提名符合条件的第三方插件",
    official: "官方",
    reviewed: "已审核的第三方插件",
    toggleNavigation: "切换导航",
    selectLanguage: "选择语言",
    latestVersionLabel: "最新版本",
    cubismVersionsLabel: "支持的 Cubism 版本",
    cubismIndependent: "不依赖特定 Cubism 版本",
    sha256Label: "SHA-256 校验和",
    downloadJar: "下载 JAR",
    viewRelease: "GitHub Release",
    viewDetails: "查看详情",
    backToDirectory: "返回插件目录",
    maintainerLabel: "维护者",
    licenseLabel: "许可证",
    categoryLabel: "分类",
    channelLabel: "通道",
    turboismApiLabel: "Turboism API 范围",
    sourceLabel: "源码仓库",
    openRepository: "打开源码仓库",
    supportLabel: "支持渠道",
    supportChannel: "问题与支持",
    verifiedReleaseTitle: "已签名目录发行版",
    officialNotice: "通过 Turboism 官方发布流水线构建并绑定至已签名 v2 目录。",
    reviewedNotice: "经审核的第三方收录条目，不代表 Turboism 官方出品、安全认证或持续兼容性支持。",
    permissionsLabel: "声明权限",
    dependenciesLabel: "插件依赖",
    categoryNames: {
      modeling: "建模",
      workflow: "工作流",
      appearance: "外观",
      analysis: "分析",
      performance: "性能",
      integration: "集成",
      system: "系统",
      development: "开发",
    },
  },
  ja: {
    home: "ホーム",
    product: "プロダクト",
    docs: "ドキュメント",
    sdk: "SDK",
    plugins: "プラグイン",
    learn: "学ぶ",
    chat: "チャット",
    download: "ダウンロード",
    github: "GitHub",
    contact: "お問い合わせ",
    report: "問題を報告",
    nominate: "サードパーティプラグインを推薦",
    request: "プラグインをリクエスト",
    search: "プラグインを検索",
    all: "すべてのプラグイン",
    language: "日本語",
    filter: "絞り込み",
    clearSearch: "検索をクリア",
    directoryLabel: "プラグインディレクトリ",
    tagsLabel: "プラグインタグ",
    categoriesLabel: "プラグインカテゴリ",
    allCategories: "すべてのカテゴリ",
    noMatchTitle: "一致するプラグインはありません。",
    noMatchGuidance: "別のキーワードを試すか、フィルターを解除してください。",
    emptyTitle: "掲載中のプラグインはまだありません。",
    emptyExplanation:
      "ディレクトリは公開されていますが、掲載条件を満たす最初のリリースを待っています。予定段階または利用できないプラグインで埋めることはありません。",
    nominateQualifying: "条件を満たすサードパーティプラグインを推薦",
    official: "公式",
    reviewed: "審査済みサードパーティ",
    toggleNavigation: "ナビゲーションを切り替える",
    selectLanguage: "言語を選択",
    latestVersionLabel: "最新バージョン",
    cubismVersionsLabel: "対応 Cubism バージョン",
    cubismIndependent: "Cubism バージョン非依存",
    sha256Label: "SHA-256",
    downloadJar: "JAR をダウンロード",
    viewRelease: "GitHub リリース",
    viewDetails: "詳細",
    backToDirectory: "ディレクトリに戻る",
    maintainerLabel: "メンテナー",
    licenseLabel: "ライセンス",
    categoryLabel: "カテゴリ",
    channelLabel: "チャンネル",
    turboismApiLabel: "Turboism API",
    sourceLabel: "ソース",
    openRepository: "リポジトリを開く",
    supportLabel: "サポート",
    supportChannel: "サポートチャンネル",
    verifiedReleaseTitle: "署名済みカタログリリース",
    officialNotice: "Turboism 公式リリースパイプラインで公開され、署名済み v2 カタログに紐付けられています。",
    reviewedNotice:
      "審査済みサードパーティ掲載であり、Turboism による開発、セキュリティ認証、または継続的な互換性サポートを意味しません。",
    permissionsLabel: "権限",
    dependenciesLabel: "依存関係",
    categoryNames: {
      modeling: "モデリング",
      workflow: "ワークフロー",
      appearance: "外観",
      analysis: "分析",
      performance: "パフォーマンス",
      integration: "統合",
      system: "システム",
      development: "開発",
    },
  },
};

const LanguageContext = createContext<{
  language: Language;
  catalogLocale: CatalogLocale;
  copy: Copy;
  setLanguage: (language: Language) => void;
}>({ language: "en", catalogLocale: "en", copy: copy.en, setLanguage: () => undefined });

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
  const [browserHint, setBrowserHint] = useState<string>("en");

  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    } catch {
      // Continue with the shared cookie or browser language.
    }

    const navLang = navigator.language || "en";
    const nextLanguage =
      readLanguageCookie() ??
      (isLanguage(saved) ? saved : null) ??
      (navLang.toLowerCase().startsWith("zh")
        ? "zh"
        : navLang.toLowerCase().startsWith("ja")
          ? "ja"
          : navLang.toLowerCase().startsWith("ko")
            ? "ko"
            : "en");
    persistLanguage(nextLanguage);
    const timer = window.setTimeout(() => {
      setBrowserHint(navLang);
      setLanguage(nextLanguage);
    }, 0);
    const update = () => {
      const selected = readLanguagePreference();
      if (selected) setLanguage(selected);
    };
    window.addEventListener("turboism:language", update);
    window.addEventListener("storage", update);
    window.addEventListener("pageshow", update);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("turboism:language", update);
      window.removeEventListener("storage", update);
      window.removeEventListener("pageshow", update);
    };
  }, []);

  function changeLanguage(nextLanguage: Language) {
    persistLanguage(nextLanguage);
    setLanguage(nextLanguage);
  }

  const catalogLocale = normalizeCatalogLocale(language, browserHint);

  return (
    <LanguageContext.Provider value={{ language, catalogLocale, copy: copy[language], setLanguage: changeLanguage }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  return useContext(LanguageContext);
}
