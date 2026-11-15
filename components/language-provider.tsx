"use client";
import { persistLanguagePreference, readLanguagePreference } from "@/brand/language-preference.mjs";
import { normalizeCatalogLocale, type CatalogLocale } from "@/lib/directory-view.mjs";
import { createContext, useContext, useEffect, useState } from "react";

export type Language = "en" | "zh" | "ja" | "ko";

const LANGUAGE_STORAGE_KEY = "turboism-interface-language";

export type AuthCopy = {
  loadingSession: string;
  signInWithGitHub: string;
  devPreviewSignIn: string;
  devPreviewBadge: string;
  mySubmissions: string;
  submitPluginAction: string;
  signOut: string;
  signingOut: string;
  oauthUnavailable: string;
};

export type SubmitWizardCopy = {
  pageTitle: string;
  pageSubtitle: string;
  step1Label: string;
  step2Label: string;
  loginRequiredTitle: string;
  loginRequiredIntro: string;
  eligibilityTitle: string;
  eligibilityItems: string[];
  minimalPermissionsTitle: string;
  minimalPermissionsBody: string;
  selectRepositoryLabel: string;
  loadingRepos: string;
  repoDropdownLabel: string;
  repoDropdownPlaceholder: string;
  manualRepoLabel: string;
  manualRepoPlaceholder: string;
  loadReleasesButton: string;
  loadingReleases: string;
  verifiedOwnerBadge: string;
  verificationReasonLabels: Record<string, string>;
  publisherFailHelpTitle: string;
  publisherFailHelpBody: string;
  existingPluginNotice: string;
  noEligibleReleases: string;
  selectReleaseLabel: string;
  selectAssetLabel: string;
  optionalFieldsTitle: string;
  slugOverrideLabel: string;
  slugOverrideHint: string;
  supportUrlLabel: string;
  supportUrlHint: string;
  summaryOverridesLabel: string;
  summaryOverridePlaceholder: string;
  runPreflightButton: string;
  runningPreflight: string;
  preflightIssuesTitle: string;
  backToStep1: string;
  l1ContractTitle: string;
  firstClaimBadge: string;
  updateReleaseBadge: string;
  pluginIdLabel: string;
  slugLabel: string;
  versionLabel: string;
  sourceRevisionLabel: string;
  artifactSizeLabel: string;
  l2AuditTitle: string;
  scannedClassesLabel: string;
  riskLevelLabel: string;
  riskLevelLabels: Record<string, string>;
  undeclaredCapabilitiesWarning: string;
  declaredPermissionsTitle: string;
  noPermissionsDeclared: string;
  bytecodeFindingsTitle: string;
  noSensitiveCallsDetected: string;
  matchedPermissionLabel: string;
  unmatchedCapabilityLabel: string;
  previewSectionTitle: string;
  cardPreviewLabel: string;
  readmePreviewLabel: string;
  noReadmeAvailable: string;
  acknowledgementTitle: string;
  acknowledgementText: string;
  submitPrButton: string;
  submittingPr: string;
  submitSuccessTitle: string;
  submitSuccessPrLink: string;
  submitActionLabels: Record<string, string>;
  simulatedPrBannerTitle: string;
  simulatedPrBannerBody: string;
  prTitleLabel: string;
  prBranchLabel: string;
  prFileLabel: string;
  prBodyLabel: string;
  goToDashboard: string;
  submitAnother: string;
};

export type DashboardCopy = {
  pageTitle: string;
  pageSubtitle: string;
  loginRequiredTitle: string;
  loginRequiredBody: string;
  loadingDashboard: string;
  refreshButton: string;
  prsSectionTitle: string;
  prIntegrationNotice: string;
  noPrsYet: string;
  prStatusLabels: Record<string, string>;
  prUpdatedLabel: string;
  openPrOnGitHub: string;
  claimedSectionTitle: string;
  noClaimedPlugins: string;
  claimedAtLabel: string;
  releasesCountLabel: string;
  submitNewReleaseButton: string;
  viewListingButton: string;
  submitFirstPluginButton: string;
};

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
  showTags: string;
  hideTags: string;
  categoriesLabel: string;
  allCategories: string;
  sourceFilterLabel: string;
  allSources: string;
  noMatchTitle: string;
  noMatchGuidance: string;
  emptyTitle: string;
  emptyExplanation: string;
  nominateQualifying: string;
  official: string;
  reviewed: string;
  thirdPartyNoticeTitle: string;
  thirdPartyNoticeBody: string;
  toggleNavigation: string;
  selectLanguage: string;
  latestVersionLabel: string;
  cubismVersionsLabel: string;
  cubismIndependent: string;
  cubismAnyVersion: string;
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
  hotReloadLabel: string;
  hotUpdateSupported: string;
  hotUpdateRequiredRestart: string;
  activeFiltersLabel: string;
  clearAllFilters: string;
  authorFilterLabel: string;
  licenseFilterLabel: string;
  permissionsLabel: string;
  permissionScopeLabels: Record<string, string>;
  dependenciesLabel: string;
  frameworkRequirementLabel: string;
  previewOnlyLabel: string;
  versionHistoryLabel: string;
  versionColumnLabel: string;
  publishedColumnLabel: string;
  recommendedLabel: string;
  readmeUnavailable: string;
  categoryNames: Record<string, string>;
  auth: AuthCopy;
  submit: SubmitWizardCopy;
  dashboard: DashboardCopy;
  submissionErrors: Record<string, string>;
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
    nominate: "서드파티 플러그인 제출",
    request: "플러그인 요청",
    search: "플러그인 검색",
    all: "모든 플러그인",
    language: "한국어",
    filter: "필터",
    clearSearch: "검색 지우기",
    directoryLabel: "플러그인 디렉터리",
    tagsLabel: "플러그인 태그",
    showTags: "태그 보기",
    hideTags: "태그 접기",
    categoriesLabel: "플러그인 카테고리",
    allCategories: "모든 카테고리",
    sourceFilterLabel: "플러그인 출처",
    allSources: "전체 출처",
    noMatchTitle: "일치하는 플러그인이 없습니다.",
    noMatchGuidance: "다른 검색어를 입력하거나 필터를 해제해 보세요.",
    emptyTitle: "아직 등록된 플러그인이 없습니다.",
    emptyExplanation:
      "디렉터리는 공개되어 있으며 등록 조건을 충족하는 첫 릴리스를 기다리고 있습니다. 계획 중이거나 사용할 수 없는 플러그인을 임시로 등록하지 않습니다.",
    nominateQualifying: "조건을 충족하는 서드파티 플러그인 제출하기",
    official: "공식",
    reviewed: "검토된 서드파티",
    thirdPartyNoticeTitle: "검토된 서드파티 플러그인 안내",
    thirdPartyNoticeBody:
      "이 항목은 커뮤니티 개발자가 유지 관리하며 구조, 매니페스트, 바이트코드 권한 검토를 거쳐 큐레이션 디렉터리에 등재되었습니다. 등재는 Turboism의 공식 보안 인증이나 지속적인 버전 호환성 보증을 의미하지 않습니다. 설치 전 소스 저장소와 선언된 권한을 확인하세요.",
    toggleNavigation: "탐색 메뉴 열기 및 닫기",
    selectLanguage: "언어 선택",
    latestVersionLabel: "최신 버전",
    cubismVersionsLabel: "지원 Cubism 버전",
    cubismIndependent: "Cubism 버전 무관",
    cubismAnyVersion: "Cubism 버전 무관",
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
    hotReloadLabel: "핫 업데이트",
    hotUpdateSupported: "핫 업데이트 지원",
    hotUpdateRequiredRestart: "업데이트를 적용하려면 Cubism 재시작 필요",
    activeFiltersLabel: "적용된 필터:",
    clearAllFilters: "모두 지우기",
    authorFilterLabel: "작성자",
    licenseFilterLabel: "라이선스",
    permissionsLabel: "권한",
    permissionScopeLabels: {
      application: "애플리케이션 범위",
      user: "사용자 범위",
    },
    dependenciesLabel: "의존성",
    frameworkRequirementLabel: "필요한 Turboism 버전",
    previewOnlyLabel: "프리뷰",
    versionHistoryLabel: "버전 기록",
    versionColumnLabel: "버전",
    publishedColumnLabel: "배포일",
    recommendedLabel: "권장",
    readmeUnavailable: "이 버전의 문서를 불러올 수 없습니다.",
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
    auth: {
      loadingSession: "GitHub 로그인 상태 확인 중...",
      signInWithGitHub: "GitHub로 로그인",
      devPreviewSignIn: "데모 계정 체험 (Dev Preview)",
      devPreviewBadge: "개발 프리뷰",
      mySubmissions: "내 제출 현황",
      submitPluginAction: "플러그인 제출",
      signOut: "로그아웃",
      signingOut: "로그아웃 중...",
      oauthUnavailable: "현재 서버에 GitHub OAuth 자격 증명이 설정되어 있지 않습니다.",
    },
    submit: {
      pageTitle: "서드파티 플러그인 제출",
      pageSubtitle:
        "GitHub 릴리스 JAR을 온라인으로 사전 검사하고 검토용 Pull Request를 생성해 큐레이션 디렉터리에 등재를 요청합니다.",
      step1Label: "1단계 · 저장소 및 릴리스 선택",
      step2Label: "2단계 · 사전 검사 리포트 및 PR 제출",
      loginRequiredTitle: "계속하려면 GitHub로 로그인하세요",
      loginRequiredIntro:
        "Turboism 플러그인 디렉터리는 무인 패키지 호스팅이 아닌 검토 기반 큐레이션 디렉터리입니다. 모든 서드파티 항목은 GitOps Pull Request를 통해 심사 및 서명됩니다.",
      eligibilityTitle: "제출 요건",
      eligibilityItems: [
        "보관되거나 비활성화되지 않은 공개 GitHub 저장소여야 합니다.",
        "명확한 오픈 소스 또는 배포 라이선스가 명시되어야 합니다.",
        "릴리스에 Schema v3/v4 META-INF/turboism/plugin.json이 포함된 단일 .jar 파일(16 MiB 이하)이 첨부되어야 합니다.",
        "역방향 도메인 ID는 dev.turboism.* 또는 예약된 경로명을 사용할 수 없습니다.",
      ],
      minimalPermissionsTitle: "최소 권한 안내",
      minimalPermissionsBody:
        "로그인 시 공개 GitHub 프로필(read:user)만 읽으며 저장소 쓰기 권한은 요구하지 않습니다. 심사 PR은 디렉터리 봇이 대신 생성합니다.",
      selectRepositoryLabel: "저장소 선택",
      loadingRepos: "공개 저장소 목록을 불러오는 중...",
      repoDropdownLabel: "내 공개 저장소",
      repoDropdownPlaceholder: "저장소 선택...",
      manualRepoLabel: "또는 owner/repo / GitHub URL 직접 입력",
      manualRepoPlaceholder: "owner/repo 또는 https://github.com/owner/repo",
      loadReleasesButton: "릴리스 불러오기",
      loadingReleases: "권한 및 릴리스 확인 중...",
      verifiedOwnerBadge: "게시 권한 확인됨",
      verificationReasonLabels: {
        repo_owner: "저장소 소유자",
        org_public_member: "조직 공개 멤버",
        publishers_manifest: "게시자 매니페스트(.github/turboism-publishers.json)",
      },
      publisherFailHelpTitle: "저장소 게시 권한을 확인할 수 없습니다",
      publisherFailHelpBody:
        "조직이 비공개 멤버십을 사용하거나 공동 메인테이너인 경우, 기본 브랜치의 .github/turboism-publishers.json 파일에 { \"publishers\": [\"your-github-login\"] } 형식으로 등록하세요.",
      existingPluginNotice: "이미 등록된 플러그인({pluginId}, slug: {slug})이 감지되었습니다. 새 상위 버전 릴리스를 제출합니다.",
      noEligibleReleases: "16 MiB 이하의 .jar 자산이 포함된 공개(non-draft) GitHub 릴리스가 없습니다.",
      selectReleaseLabel: "대상 릴리스 태그",
      selectAssetLabel: "JAR 자산",
      optionalFieldsTitle: "선택 메타데이터 재정의",
      slugOverrideLabel: "디렉터리 슬러그 (선택)",
      slugOverrideHint: "소문자 kebab-case. 비워 두면 저장소 이름에서 자동 생성됩니다.",
      supportUrlLabel: "지원 URL (선택)",
      supportUrlHint: "HTTPS URL만 허용됩니다. 비워 두면 저장소 Issues 링크를 사용합니다.",
      summaryOverridesLabel: "다국어 한 줄 요약 미리보기 보정 (선택)",
      summaryOverridePlaceholder: "선택 사항: 미리보기용 요약 문구",
      runPreflightButton: "온라인 사전 검사 실행",
      runningPreflight: "JAR 다운로드 및 정적 분석 중...",
      preflightIssuesTitle: "사전 검사 항목을 통과하지 못했습니다",
      backToStep1: "1단계로 돌아가기",
      l1ContractTitle: "L1 계약 및 소유권 잠금 검증",
      firstClaimBadge: "최초 소유권 등록",
      updateReleaseBadge: "기존 소유 플러그인 버전 업데이트",
      pluginIdLabel: "플러그인 ID",
      slugLabel: "URL 슬러그",
      versionLabel: "버전 / 채널",
      sourceRevisionLabel: "소스 커밋 SHA",
      artifactSizeLabel: "JAR 크기 / SHA-256",
      l2AuditTitle: "L2 바이트코드 정적 권한 감사",
      scannedClassesLabel: "검사된 클래스 수",
      riskLevelLabel: "위험 등급",
      riskLevelLabels: {
        low: "낮음 (Low)",
        medium: "보통 (Medium)",
        high: "높음 (High)",
      },
      undeclaredCapabilitiesWarning: "선언되지 않은 민감 API 호출 감지됨:",
      declaredPermissionsTitle: "선언된 권한",
      noPermissionsDeclared: "이 릴리스는 추가 권한을 선언하지 않았습니다.",
      bytecodeFindingsTitle: "감지된 민감 API 호출",
      noSensitiveCallsDetected: "감지된 민감 API 호출이 없습니다.",
      matchedPermissionLabel: "선언 일치",
      unmatchedCapabilityLabel: "미선언 호출",
      previewSectionTitle: "디렉터리 카드 및 README 미리보기",
      cardPreviewLabel: "목록 카드 미리보기",
      readmePreviewLabel: "서버 정제 README 미리보기",
      noReadmeAvailable: "추출된 README 문서가 없습니다.",
      acknowledgementTitle: "제출 확인 및 약관 동의",
      acknowledgementText:
        "본인은 이 저장소의 합법적 게시 권한을 보유하고 있으며, 디렉터리 등재가 공식 보안 인증이나 장기 호환성 보증이 아닌 '검토된 서드파티' 등재임을 이해하고, 게시된 릴리스의 동일 이름 .jar 자산을 임의로 교체하지 않을 것을 약속합니다.",
      submitPrButton: "검토 Pull Request 제출",
      submittingPr: "검토 PR 생성 중...",
      submitSuccessTitle: "제출이 완료되었습니다",
      submitSuccessPrLink: "GitHub에서 Pull Request 보기",
      submitActionLabels: {
        created: "새 PR 생성됨",
        updated: "기존 PR 업데이트됨",
      },
      simulatedPrBannerTitle: "Dev Mock 시뮬레이션 결과",
      simulatedPrBannerBody:
        "개발 프리뷰 모드에서는 실제 GitHub PR을 생성하지 않고 생성될 PR 제목과 본문을 미리 보여줍니다.",
      prTitleLabel: "PR 제목",
      prBranchLabel: "브랜치",
      prFileLabel: "매니페스트 경로",
      prBodyLabel: "PR 본문",
      goToDashboard: "내 제출 현황으로 이동",
      submitAnother: "다른 릴리스 제출하기",
    },
    dashboard: {
      pageTitle: "게시자 콘솔",
      pageSubtitle: "내 GitHub 계정에 귀속된 플러그인과 진행 중인 제출 Pull Request를 관리합니다.",
      loginRequiredTitle: "게시자 콘솔을 보려면 로그인하세요",
      loginRequiredBody:
        "GitHub 계정으로 로그인하면 제출한 심사 PR 상태와 소유가 확인된 디렉터리 플러그인을 확인할 수 있습니다.",
      loadingDashboard: "제출 내역 및 소유 플러그인을 불러오는 중...",
      refreshButton: "새로 고침",
      prsSectionTitle: "심사 중 및 최근 제출 PR",
      prIntegrationNotice:
        "이 환경에는 GitHub App PR 조회 자격 증명이 설정되어 있지 않아 로컬에 등재된 소유 플러그인만 표시됩니다.",
      noPrsYet: "아직 제출된 Pull Request 기록이 없습니다.",
      prStatusLabels: {
        open: "검토 중 (Open)",
        merged: "병합됨 (Merged)",
        closed: "닫힘 (Closed)",
      },
      prUpdatedLabel: "최근 업데이트",
      openPrOnGitHub: "PR 열기",
      claimedSectionTitle: "소유권이 등록된 디렉터리 플러그인",
      noClaimedPlugins: "아직 이 계정에 귀속된 디렉터리 플러그인이 없습니다.",
      claimedAtLabel: "등록일",
      releasesCountLabel: "활성 릴리스 수",
      submitNewReleaseButton: "새 버전 제출",
      viewListingButton: "목록 페이지",
      submitFirstPluginButton: "첫 플러그인 제출하기",
    },
    submissionErrors: {
      unauthorized: "로그인이 만료되었거나 인증되지 않았습니다. 다시 로그인해 주세요.",
      csrf_origin_mismatch: "요청 출처 검증에 실패했습니다. 페이지를 새로 고친 후 다시 시도하세요.",
      invalid_repository: "저장소 형식이 올바르지 않습니다. owner/repo 또는 https://github.com/owner/repo 형식을 사용하세요.",
      invalid_release_tag: "대상 릴리스 태그를 선택해 주세요.",
      invalid_preview_overrides: "지원 URL은 HTTPS 형식이어야 하며 요약 재정의는 문자열이어야 합니다.",
      publisher_verification_failed: "이 저장소에 대한 게시 권한 검증에 실패했습니다.",
      release_not_found: "선택한 태그의 공개 릴리스를 찾을 수 없습니다.",
      asset_not_found: "선택한 .jar 자산을 릴리스에서 찾을 수 없습니다.",
      ambiguous_asset: "릴리스에 여러 .jar 자산이 있습니다. 하나를 명시적으로 선택하세요.",
      preflight_failed: "JAR 사전 검사에서 하나 이상의 계약 또는 보안 규칙을 위반했습니다.",
      submission_rate_limited: "열려 있는 제출 PR 수가 한도를 초과했습니다. 기존 PR 처리 후 다시 시도하세요.",
      github_oauth_config_missing: "서버에 GitHub OAuth가 구성되어 있지 않습니다.",
      github_app_config_missing: "서버에 제출용 GitHub App 봇이 구성되어 있지 않습니다.",
      github_api_error: "GitHub API 통신 중 오류가 발생했습니다. 잠시 후 다시 시도하세요.",
      untrusted_download_host: "릴리스 자산 다운로드 호스트가 신뢰할 수 있는 GitHub 도메인이 아닙니다.",
      redirect_limit_exceeded: "다운로드 리디렉션 횟수 제한을 초과했습니다.",
      artifact_size_invalid: "JAR 파일 크기가 허용 범위(1B–16 MiB)를 벗어났습니다.",
      tag_resolution_failed: "릴리스 태그의 40자리 커밋 SHA를 확인할 수 없습니다.",
      unknown: "요청을 처리하는 중 예기치 않은 오류가 발생했습니다.",
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
    nominate: "Submit a plugin",
    request: "Plugin request",
    search: "Search plugins",
    all: "All plugins",
    language: "English",
    filter: "Filter",
    clearSearch: "Clear search",
    directoryLabel: "Plugin directory",
    tagsLabel: "Plugin tags",
    showTags: "Show tags",
    hideTags: "Hide tags",
    categoriesLabel: "Plugin categories",
    allCategories: "All categories",
    sourceFilterLabel: "Source",
    allSources: "All sources",
    noMatchTitle: "No matching plugins.",
    noMatchGuidance: "Try another search or remove the filter.",
    emptyTitle: "No plugins listed yet.",
    emptyExplanation:
      "The directory is live before its first qualifying release. We will not fill it with planned or unavailable placeholders.",
    nominateQualifying: "Submit a qualifying third-party plugin",
    official: "Official",
    reviewed: "Reviewed third-party",
    thirdPartyNoticeTitle: "Reviewed third-party listing notice",
    thirdPartyNoticeBody:
      "This entry is maintained by a community developer and listed after structure, manifest, and bytecode capability review. Listing does not imply official Turboism security certification or ongoing compatibility support. Inspect the source repository and declared permissions before installing.",
    toggleNavigation: "Toggle navigation",
    selectLanguage: "Select language",
    latestVersionLabel: "Latest version",
    cubismVersionsLabel: "Supported Cubism versions",
    cubismIndependent: "Editor-independent",
    cubismAnyVersion: "Any Cubism version",
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
    hotReloadLabel: "Hot update",
    hotUpdateSupported: "Hot update supported",
    hotUpdateRequiredRestart: "Restart Cubism to apply updates",
    activeFiltersLabel: "Active filters:",
    clearAllFilters: "Clear all",
    authorFilterLabel: "Author",
    licenseFilterLabel: "License",
    permissionsLabel: "Permissions",
    permissionScopeLabels: {
      application: "application scope",
      user: "user scope",
    },
    dependenciesLabel: "Dependencies",
    frameworkRequirementLabel: "Required Turboism version",
    previewOnlyLabel: "Preview",
    versionHistoryLabel: "Version history",
    versionColumnLabel: "Version",
    publishedColumnLabel: "Published",
    recommendedLabel: "Recommended",
    readmeUnavailable: "Documentation is unavailable for this version.",
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
    auth: {
      loadingSession: "Checking GitHub session...",
      signInWithGitHub: "Sign in with GitHub",
      devPreviewSignIn: "Demo Sign-In (Dev Preview)",
      devPreviewBadge: "Dev Preview",
      mySubmissions: "My submissions",
      submitPluginAction: "Submit plugin",
      signOut: "Sign out",
      signingOut: "Signing out...",
      oauthUnavailable: "GitHub OAuth credentials are not configured on this server.",
    },
    submit: {
      pageTitle: "Submit a Third-Party Plugin",
      pageSubtitle:
        "Run online preflight inspection on a public GitHub Release JAR and open a GitOps review pull request for the Curated Plugin Directory.",
      step1Label: "Step 1 · Repository & Release",
      step2Label: "Step 2 · Preflight Report & PR",
      loginRequiredTitle: "Sign in with GitHub to continue",
      loginRequiredIntro:
        "Turboism Plugins is a Curated Plugin Directory, not an unmoderated package host. Every third-party listing goes through preflight inspection and a GitOps pull request review.",
      eligibilityTitle: "Admission requirements",
      eligibilityItems: [
        "Public, non-archived, active GitHub repository with an explicit open-source or distribution license.",
        "Published GitHub Release with a single .jar asset (<= 16 MiB) containing Schema v3 or v4 META-INF/turboism/plugin.json.",
        "Reverse-domain plugin id outside dev.turboism.* and retired first-party namespaces, plus a non-reserved slug.",
      ],
      minimalPermissionsTitle: "Least-privilege OAuth scope",
      minimalPermissionsBody:
        "Sign-in requests read:user only to verify your public GitHub identity. We never request repository write access; the directory bot opens the review pull request.",
      selectRepositoryLabel: "Choose repository",
      loadingRepos: "Loading your public repositories...",
      repoDropdownLabel: "Your public repositories",
      repoDropdownPlaceholder: "Select a repository...",
      manualRepoLabel: "Or enter owner/repo or GitHub URL",
      manualRepoPlaceholder: "owner/repo or https://github.com/owner/repo",
      loadReleasesButton: "Load releases",
      loadingReleases: "Verifying ownership & loading releases...",
      verifiedOwnerBadge: "Publisher verified",
      verificationReasonLabels: {
        repo_owner: "Repository owner",
        org_public_member: "Public organization member",
        publishers_manifest: "Publishers manifest (.github/turboism-publishers.json)",
      },
      publisherFailHelpTitle: "Repository publishing authority could not be verified",
      publisherFailHelpBody:
        "If your organization membership is private or you are a collaborator, commit .github/turboism-publishers.json on the default branch with { \"publishers\": [\"your-github-login\"] }.",
      existingPluginNotice: "Existing cataloged plugin detected ({pluginId}, slug: {slug}). Submitting a new higher release version.",
      noEligibleReleases: "No eligible non-draft releases with a .jar asset (<= 16 MiB) were found.",
      selectReleaseLabel: "Target release tag",
      selectAssetLabel: "JAR asset",
      optionalFieldsTitle: "Optional listing overrides",
      slugOverrideLabel: "Directory slug (optional)",
      slugOverrideHint: "Lowercase kebab-case. Derived from repository name if left blank.",
      supportUrlLabel: "Support URL (optional)",
      supportUrlHint: "Must use HTTPS. Defaults to repository issues when omitted.",
      summaryOverridesLabel: "Localized summary preview overrides (optional)",
      summaryOverridePlaceholder: "Optional summary override for preview",
      runPreflightButton: "Run preflight inspection",
      runningPreflight: "Downloading JAR and auditing bytecode...",
      preflightIssuesTitle: "Preflight inspection failed",
      backToStep1: "Back to Step 1",
      l1ContractTitle: "L1 Contract & Ownership Lock",
      firstClaimBadge: "First-time plugin claim",
      updateReleaseBadge: "New release for claimed plugin",
      pluginIdLabel: "Plugin ID",
      slugLabel: "Slug",
      versionLabel: "Version / Channel",
      sourceRevisionLabel: "Source commit SHA",
      artifactSizeLabel: "JAR size / SHA-256",
      l2AuditTitle: "L2 Bytecode Capability Audit",
      scannedClassesLabel: "Scanned .class files",
      riskLevelLabel: "Risk level",
      riskLevelLabels: {
        low: "Low",
        medium: "Medium",
        high: "High",
      },
      undeclaredCapabilitiesWarning: "Undeclared sensitive capabilities detected:",
      declaredPermissionsTitle: "Declared permissions",
      noPermissionsDeclared: "No permissions declared in plugin descriptor.",
      bytecodeFindingsTitle: "Detected sensitive bytecode references",
      noSensitiveCallsDetected: "No sensitive bytecode calls detected.",
      matchedPermissionLabel: "Declared",
      unmatchedCapabilityLabel: "Undeclared",
      previewSectionTitle: "Directory Card & README Preview",
      cardPreviewLabel: "Directory card preview",
      readmePreviewLabel: "Server-sanitized README preview",
      noReadmeAvailable: "No README documentation found for this release.",
      acknowledgementTitle: "Publisher declaration",
      acknowledgementText:
        "I confirm that I hold lawful publishing authority for this repository, understand that directory listing is a Reviewed third-party entry (not official security certification or ongoing compatibility support), and commit not to replace the .jar asset on the published GitHub Release.",
      submitPrButton: "Submit review pull request",
      submittingPr: "Opening review pull request...",
      submitSuccessTitle: "Submission completed",
      submitSuccessPrLink: "View pull request on GitHub",
      submitActionLabels: {
        created: "Created",
        updated: "Updated",
      },
      simulatedPrBannerTitle: "Dev Mock Simulated Pull Request",
      simulatedPrBannerBody:
        "In Dev Preview mode, no remote GitHub PR is created. Below is the exact pull request payload that would be opened.",
      prTitleLabel: "PR Title",
      prBranchLabel: "Branch",
      prFileLabel: "Manifest path",
      prBodyLabel: "PR Body",
      goToDashboard: "Go to My submissions",
      submitAnother: "Submit another release",
    },
    dashboard: {
      pageTitle: "Publisher Console",
      pageSubtitle: "Track your submission pull requests and manage third-party plugins claimed by your GitHub account.",
      loginRequiredTitle: "Sign in to view your publisher console",
      loginRequiredBody:
        "Authenticate with GitHub to inspect your active review pull requests and release updates for plugins claimed under your account.",
      loadingDashboard: "Loading your submissions and claimed plugins...",
      refreshButton: "Refresh",
      prsSectionTitle: "Submission Pull Requests",
      prIntegrationNotice:
        "GitHub App pull request integration is not configured in this environment. Only locally cataloged claimed plugins are shown below.",
      noPrsYet: "No submission pull requests found for your account yet.",
      prStatusLabels: {
        open: "Open",
        merged: "Merged",
        closed: "Closed",
      },
      prUpdatedLabel: "Updated",
      openPrOnGitHub: "Open PR",
      claimedSectionTitle: "Claimed Directory Plugins",
      noClaimedPlugins: "No directory plugins are currently claimed by your GitHub account.",
      claimedAtLabel: "Claimed",
      releasesCountLabel: "Active releases",
      submitNewReleaseButton: "Submit new release",
      viewListingButton: "View listing",
      submitFirstPluginButton: "Submit a plugin",
    },
    submissionErrors: {
      unauthorized: "Authentication required or session expired. Please sign in again.",
      csrf_origin_mismatch: "Same-origin check failed. Reload the page and retry.",
      invalid_repository: "Invalid repository format. Use owner/repo or https://github.com/owner/repo.",
      invalid_release_tag: "Please select a target release tag.",
      invalid_preview_overrides: "Support URL must use HTTPS and summary overrides must be plain text.",
      publisher_verification_failed: "Publisher verification failed for this repository.",
      release_not_found: "Eligible non-draft release for this tag was not found.",
      asset_not_found: "Selected .jar asset was not found on this release.",
      ambiguous_asset: "Multiple .jar assets exist on this release. Select one explicitly.",
      preflight_failed: "Plugin JAR failed one or more preflight contract or security checks.",
      submission_rate_limited: "You have reached the maximum number of open submission pull requests.",
      github_oauth_config_missing: "GitHub OAuth credentials are not configured on this server.",
      github_app_config_missing: "GitHub submission bot credentials are not configured on this server.",
      github_api_error: "GitHub API request failed. Please try again shortly.",
      untrusted_download_host: "Release download redirected to an untrusted host.",
      redirect_limit_exceeded: "Release download exceeded the redirect limit.",
      artifact_size_invalid: "JAR asset size is outside the allowed 1 B–16 MiB range.",
      tag_resolution_failed: "Could not resolve the 40-character commit SHA for this release tag.",
      unknown: "An unexpected error occurred while processing your request.",
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
    nominate: "提交插件",
    request: "插件请求",
    search: "搜索插件",
    all: "全部插件",
    language: "简体中文",
    filter: "筛选",
    clearSearch: "清除搜索",
    directoryLabel: "插件目录",
    tagsLabel: "插件标签",
    showTags: "展开标签",
    hideTags: "收起标签",
    categoriesLabel: "插件分类",
    allCategories: "全部分类",
    sourceFilterLabel: "插件来源",
    allSources: "全部来源",
    noMatchTitle: "没有匹配的插件。",
    noMatchGuidance: "请尝试其他关键词或清除筛选条件。",
    emptyTitle: "暂无已收录插件。",
    emptyExplanation:
      "目录已上线，正在等待首个符合收录条件的正式版本。我们不会用计划中或尚不可用的占位插件填充目录。",
    nominateQualifying: "提交符合条件的第三方插件",
    official: "官方",
    reviewed: "已审第三方",
    thirdPartyNoticeTitle: "已审第三方插件收录声明",
    thirdPartyNoticeBody:
      "本条目由社区开发者维护，经目录结构、清单规范与字节码静态能力审查后收录。目录收录不代表 Turboism 官方安全认证，亦不提供长期版本兼容担保；安装前请核查仓库源码与插件声明权限。",
    toggleNavigation: "切换导航",
    selectLanguage: "选择语言",
    latestVersionLabel: "最新版本",
    cubismVersionsLabel: "支持的 Cubism 版本",
    cubismIndependent: "不依赖特定 Cubism 版本",
    cubismAnyVersion: "不限 Cubism 版本",
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
    hotReloadLabel: "热更新",
    hotUpdateSupported: "支持热更新",
    hotUpdateRequiredRestart: "更新后需重启 Cubism",
    activeFiltersLabel: "已启用的筛选：",
    clearAllFilters: "清除全部",
    authorFilterLabel: "作者",
    licenseFilterLabel: "许可证",
    permissionsLabel: "声明权限",
    permissionScopeLabels: {
      application: "应用级权限",
      user: "用户级权限",
    },
    dependenciesLabel: "插件依赖",
    frameworkRequirementLabel: "需要的 Turboism 版本",
    previewOnlyLabel: "预览版",
    versionHistoryLabel: "版本历史",
    versionColumnLabel: "版本",
    publishedColumnLabel: "发布日期",
    recommendedLabel: "推荐",
    readmeUnavailable: "此版本文档暂不可用。",
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
    auth: {
      loadingSession: "正在检查 GitHub 登录状态...",
      signInWithGitHub: "GitHub 登录",
      devPreviewSignIn: "演示账号一键体验 (Dev Preview)",
      devPreviewBadge: "开发预览",
      mySubmissions: "我的插件",
      submitPluginAction: "提交插件",
      signOut: "退出",
      signingOut: "正在退出...",
      oauthUnavailable: "当前服务器尚未配置 GitHub OAuth 凭证。",
    },
    submit: {
      pageTitle: "提交第三方插件",
      pageSubtitle:
        "在线执行公共 GitHub Release JAR 的合规预检，并通过 GitOps Pull Request 向经审核插件目录提交收录申请。",
      step1Label: "第一步 · 选择仓库与 Release",
      step2Label: "第二步 · 预检报告与提交 PR",
      loginRequiredTitle: "请先使用 GitHub 登录",
      loginRequiredIntro:
        "本站点是经审核的插件目录（Curated Plugin Directory），而非自助无审包托管市场。所有第三方条目均须经过自动化预检与人工 GitOps Pull Request 审核。",
      eligibilityTitle: "目录准入要求",
      eligibilityItems: [
        "公开、未归档且处于活跃状态的 GitHub 仓库，具备明确的开源或分发许可证。",
        "非草稿 GitHub Release 中附带单个 <= 16 MiB 的 .jar 资产，内含 Schema v3/v4 META-INF/turboism/plugin.json。",
        "反向域名 plugin.id 不得占用 dev.turboism.* 或已退役官方 ID，且 slug 不得与目录保留路由冲突。",
      ],
      minimalPermissionsTitle: "最小权限说明",
      minimalPermissionsBody:
        "GitHub 登录仅请求 read:user 读取公开身份，绝不申请仓库写入权限；审核 Pull Request 由目录机器人以最小权限代为提交。",
      selectRepositoryLabel: "选择仓库",
      loadingRepos: "正在加载公开仓库列表...",
      repoDropdownLabel: "我的公开仓库",
      repoDropdownPlaceholder: "选择仓库...",
      manualRepoLabel: "或手动输入 owner/repo 或 GitHub 仓库链接",
      manualRepoPlaceholder: "owner/repo 或 https://github.com/owner/repo",
      loadReleasesButton: "加载 Release",
      loadingReleases: "正在校验归属并加载 Release...",
      verifiedOwnerBadge: "发布权限已核验",
      verificationReasonLabels: {
        repo_owner: "仓库所有者",
        org_public_member: "组织公开成员",
        publishers_manifest: "发布者清单 (.github/turboism-publishers.json)",
      },
      publisherFailHelpTitle: "无法核验该仓库的发布归属权",
      publisherFailHelpBody:
        "若您属于组织私有成员或协作者，请在仓库默认分支根目录提交 .github/turboism-publishers.json，内容格式为 { \"publishers\": [\"your-github-login\"] }。",
      existingPluginNotice: "检测到已收录插件（{pluginId}，slug: {slug}），本次提交将作为更高版本更新审核。",
      noEligibleReleases: "未找到包含 <= 16 MiB .jar 资产的非草稿 GitHub Release。",
      selectReleaseLabel: "目标 Release Tag",
      selectAssetLabel: "JAR 构建产物",
      optionalFieldsTitle: "可选信息微调",
      slugOverrideLabel: "目录 Slug（可选）",
      slugOverrideHint: "小写 kebab-case；留空则由后端根据仓库名自动推导。",
      supportUrlLabel: "支持渠道 URL（可选）",
      supportUrlHint: "仅允许 HTTPS 链接；留空默认指向仓库 Issues。",
      summaryOverridesLabel: "多语言简介预览微调（可选）",
      summaryOverridePlaceholder: "可选：覆盖用于预览的简短说明",
      runPreflightButton: "运行在线预检",
      runningPreflight: "正在拉取 JAR 并执行契约与字节码审计...",
      preflightIssuesTitle: "预检未通过",
      backToStep1: "返回上一步",
      l1ContractTitle: "L1 契约与归属锁定校验",
      firstClaimBadge: "首次认领插件",
      updateReleaseBadge: "已认领插件新版本",
      pluginIdLabel: "插件 ID",
      slugLabel: "路由 Slug",
      versionLabel: "版本 / 通道",
      sourceRevisionLabel: "源码提交 SHA",
      artifactSizeLabel: "JAR 体积 / SHA-256",
      l2AuditTitle: "L2 字节码静态能力审计",
      scannedClassesLabel: "已扫描 .class 数量",
      riskLevelLabel: "风险等级",
      riskLevelLabels: {
        low: "低 (Low)",
        medium: "中 (Medium)",
        high: "高 (High)",
      },
      undeclaredCapabilitiesWarning: "检测到未声明的敏感能力调用：",
      declaredPermissionsTitle: "插件声明权限",
      noPermissionsDeclared: "当前描述符未声明额外权限。",
      bytecodeFindingsTitle: "检测到的敏感字节码调用",
      noSensitiveCallsDetected: "未检测到敏感系统/网络/反射调用。",
      matchedPermissionLabel: "已声明匹配",
      unmatchedCapabilityLabel: "未声明调用",
      previewSectionTitle: "目录卡片与 README 实时预览",
      cardPreviewLabel: "目录卡片预览",
      readmePreviewLabel: "服务端安全渲染 README 预览",
      noReadmeAvailable: "该版本未附带 README 文档。",
      acknowledgementTitle: "发布者声明与确认",
      acknowledgementText:
        "本人确认拥有该仓库的合法发布权，知悉目录收录属于「已审第三方（Reviewed third-party）」（不构成 Turboism 官方安全认证或长期兼容担保），并承诺不替换已发布 GitHub Release 中的同名 .jar 资产。",
      submitPrButton: "提交审核 PR",
      submittingPr: "正在提交审核 Pull Request...",
      submitSuccessTitle: "审核 PR 提交成功",
      submitSuccessPrLink: "前往 GitHub 查看 Pull Request",
      submitActionLabels: {
        created: "已新建",
        updated: "已更新",
      },
      simulatedPrBannerTitle: "Dev Mock 本地模拟 PR 预览",
      simulatedPrBannerBody:
        "当前处于开发预览模拟模式，未向 GitHub 发起真实 PR；下方展示实际将生成的完整 PR 标题、路径与正文。",
      prTitleLabel: "PR 标题",
      prBranchLabel: "目标分支",
      prFileLabel: "清单文件路径",
      prBodyLabel: "PR 正文预览",
      goToDashboard: "前往我的提交",
      submitAnother: "继续提交其他版本",
    },
    dashboard: {
      pageTitle: "发布者控制台",
      pageSubtitle: "查看由您发起的插件审核 Pull Request，并管理名下已认领上架的第三方插件。",
      loginRequiredTitle: "登录后查看发布者控制台",
      loginRequiredBody:
        "使用 GitHub 登录后，可统一追踪待审核 PR 状态并一键为已认领插件提交新版本。",
      loadingDashboard: "正在加载提交记录与名下插件...",
      refreshButton: "刷新状态",
      prsSectionTitle: "审核中与近期提交记录",
      prIntegrationNotice:
        "当前服务端未配置 GitHub App PR 查询凭证，此处仅展示本地已收录归属您的插件。",
      noPrsYet: "暂无与您账号关联的插件提交 Pull Request。",
      prStatusLabels: {
        open: "审核中 (Open)",
        merged: "已合并 (Merged)",
        closed: "已关闭 (Closed)",
      },
      prUpdatedLabel: "更新时间",
      openPrOnGitHub: "查看 PR",
      claimedSectionTitle: "名下已认领上架插件",
      noClaimedPlugins: "当前 GitHub 账号名下暂无已认领上架的目录插件。",
      claimedAtLabel: "认领时间",
      releasesCountLabel: "已收录版本数",
      submitNewReleaseButton: "提交新版本",
      viewListingButton: "查看目录页",
      submitFirstPluginButton: "去提交首个插件",
    },
    submissionErrors: {
      unauthorized: "登录状态已失效或未登录，请重新使用 GitHub 登录。",
      csrf_origin_mismatch: "同源校验未通过，请刷新页面后重试。",
      invalid_repository: "仓库格式无效，请输入 owner/repo 或 https://github.com/owner/repo。",
      invalid_release_tag: "请选择目标 Release Tag。",
      invalid_preview_overrides: "支持链接必须使用 HTTPS，简介微调字段必须为纯文本。",
      publisher_verification_failed: "无法核验您对该仓库的发布归属权限。",
      release_not_found: "未找到对应 Tag 的可用公开 Release。",
      asset_not_found: "在该 Release 下未找到所选 .jar 资产。",
      ambiguous_asset: "该 Release 包含多个 .jar 资产，请明确指定其中一个。",
      preflight_failed: "插件 JAR 未通过契约或安全预检，请根据下方明细修正。",
      submission_rate_limited: "您当前待审核的提交 PR 数量已达上限，请等待现有 PR 处理完成。",
      github_oauth_config_missing: "服务端尚未配置 GitHub OAuth 凭证。",
      github_app_config_missing: "服务端尚未配置提交机器人 GitHub App 凭证。",
      github_api_error: "GitHub API 调用失败，请稍后重试。",
      untrusted_download_host: "Release 下载重定向到了不受信任的主机。",
      redirect_limit_exceeded: "Release 资产下载重定向次数超出安全限制。",
      artifact_size_invalid: "JAR 资产大小超出 1 B – 16 MiB 允许范围。",
      tag_resolution_failed: "无法解析该 Release Tag 对应的 40 位提交 SHA。",
      unknown: "处理请求时发生未知错误，请稍后重试。",
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
    nominate: "プラグインを提出",
    request: "プラグインをリクエスト",
    search: "プラグインを検索",
    all: "すべてのプラグイン",
    language: "日本語",
    filter: "絞り込み",
    clearSearch: "検索をクリア",
    directoryLabel: "プラグインディレクトリ",
    tagsLabel: "プラグインタグ",
    showTags: "タグを表示",
    hideTags: "タグを閉じる",
    categoriesLabel: "プラグインカテゴリ",
    allCategories: "すべてのカテゴリ",
    sourceFilterLabel: "公開元",
    allSources: "すべて",
    noMatchTitle: "一致するプラグインはありません。",
    noMatchGuidance: "別のキーワードを試すか、フィルターを解除してください。",
    emptyTitle: "掲載中のプラグインはまだありません。",
    emptyExplanation:
      "ディレクトリは公開されていますが、掲載条件を満たす最初のリリースを待っています。予定段階または利用できないプラグインで埋めることはありません。",
    nominateQualifying: "条件を満たすサードパーティプラグインを提出",
    official: "公式",
    reviewed: "審査済みサードパーティ",
    thirdPartyNoticeTitle: "審査済みサードパーティ掲載に関する注記",
    thirdPartyNoticeBody:
      "このエントリはコミュニティ開発者によって保守され、構造・マニフェスト・バイトコード権限の事前審査を経て掲載されています。掲載は Turboism 公式のセキュリティ認証や継続的な互換性保証を意味するものではありません。導入前にソースリポジトリと宣言された権限を確認してください。",
    toggleNavigation: "ナビゲーションを切り替える",
    selectLanguage: "言語を選択",
    latestVersionLabel: "最新バージョン",
    cubismVersionsLabel: "対応 Cubism バージョン",
    cubismIndependent: "Cubism バージョン非依存",
    cubismAnyVersion: "Cubism バージョン不問",
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
    hotReloadLabel: "ホットアップデート",
    hotUpdateSupported: "ホットアップデート対応",
    hotUpdateRequiredRestart: "更新の適用には Cubism の再起動が必要",
    activeFiltersLabel: "適用中のフィルター：",
    clearAllFilters: "すべてクリア",
    authorFilterLabel: "作成者",
    licenseFilterLabel: "ライセンス",
    permissionsLabel: "権限",
    permissionScopeLabels: {
      application: "アプリケーションスコープ",
      user: "ユーザースコープ",
    },
    dependenciesLabel: "依存関係",
    frameworkRequirementLabel: "必要な Turboism バージョン",
    previewOnlyLabel: "プレビュー",
    versionHistoryLabel: "バージョン履歴",
    versionColumnLabel: "バージョン",
    publishedColumnLabel: "公開日",
    recommendedLabel: "推奨",
    readmeUnavailable: "このバージョンのドキュメントは利用できません。",
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
    auth: {
      loadingSession: "GitHub セッションを確認中...",
      signInWithGitHub: "GitHub でサインイン",
      devPreviewSignIn: "デモアカウントで体験 (Dev Preview)",
      devPreviewBadge: "開発プレビュー",
      mySubmissions: "マイ提出一覧",
      submitPluginAction: "プラグインを提出",
      signOut: "サインアウト",
      signingOut: "サインアウト中...",
      oauthUnavailable: "このサーバーでは GitHub OAuth が設定されていません。",
    },
    submit: {
      pageTitle: "サードパーティプラグインを提出",
      pageSubtitle:
        "公開 GitHub リリース JAR のオンライン事前検査を実行し、審査済みプラグインディレクトリへの GitOps Pull Request を作成します。",
      step1Label: "ステップ 1 · リポジトリとリリース選択",
      step2Label: "ステップ 2 · 事前検査レポートと PR 提出",
      loginRequiredTitle: "続行するには GitHub でサインインしてください",
      loginRequiredIntro:
        "本サイトは無審査のパッケージレジストリではなく、審査済みプラグインディレクトリです。すべてのサードパーティ掲載は事前検査と GitOps Pull Request 審査を経ます。",
      eligibilityTitle: "掲載要件",
      eligibilityItems: [
        "アーカイブや無効化されていない公開 GitHub リポジトリで、明確なライセンスがあること。",
        "非ドラフトの GitHub リリースに Schema v3/v4 の META-INF/turboism/plugin.json を含む単一 .jar（16 MiB 以下）が添付されていること。",
        "逆ドメイン ID が dev.turboism.* や廃止済み公式 ID と重複せず、スラッグが予約語でないこと。",
      ],
      minimalPermissionsTitle: "最小権限ポリシー",
      minimalPermissionsBody:
        "サインインでは公開 GitHub プロフィール（read:user）のみを取得し、リポジトリへの書き込み権限は要求しません。審査用 PR はディレクトリボットが作成します。",
      selectRepositoryLabel: "リポジトリを選択",
      loadingRepos: "公開リポジトリを読み込み中...",
      repoDropdownLabel: "公開リポジトリ一覧",
      repoDropdownPlaceholder: "リポジトリを選択...",
      manualRepoLabel: "または owner/repo / GitHub URL を入力",
      manualRepoPlaceholder: "owner/repo または https://github.com/owner/repo",
      loadReleasesButton: "リリースを読み込む",
      loadingReleases: "権限確認とリリース読み込み中...",
      verifiedOwnerBadge: "公開権限を確認済み",
      verificationReasonLabels: {
        repo_owner: "リポジトリ所有者",
        org_public_member: "組織の公開メンバー",
        publishers_manifest: "公開者マニフェスト (.github/turboism-publishers.json)",
      },
      publisherFailHelpTitle: "リポジトリの公開権限を確認できませんでした",
      publisherFailHelpBody:
        "組織メンバーシップが非公開の場合や共同メンテナーの場合は、デフォルトブランチに .github/turboism-publishers.json を { \"publishers\": [\"your-github-login\"] } 形式で配置してください。",
      existingPluginNotice: "既存の掲載プラグイン（{pluginId}、slug: {slug}）を検出しました。より新しいバージョンの提出として扱われます。",
      noEligibleReleases: "16 MiB 以下の .jar を含む非ドラフトリリースが見つかりませんでした。",
      selectReleaseLabel: "対象リリースタグ",
      selectAssetLabel: "JAR アセット",
      optionalFieldsTitle: "オプションの上書き設定",
      slugOverrideLabel: "ディレクトリスラッグ（任意）",
      slugOverrideHint: "小文字の kebab-case。空欄の場合はリポジトリ名から自動生成されます。",
      supportUrlLabel: "サポート URL（任意）",
      supportUrlHint: "HTTPS URL のみ有効です。空欄時はリポジトリの Issues を使用します。",
      summaryOverridesLabel: "多言語サマリープレビュー調整（任意）",
      summaryOverridePlaceholder: "任意：プレビュー用の要約文",
      runPreflightButton: "オンライン事前検査を実行",
      runningPreflight: "JAR を取得して静的解析を実行中...",
      preflightIssuesTitle: "事前検査で問題が検出されました",
      backToStep1: "ステップ 1 に戻る",
      l1ContractTitle: "L1 契約・所有権ロック検証",
      firstClaimBadge: "初回プラグイン登録",
      updateReleaseBadge: "登録済みプラグインの新バージョン",
      pluginIdLabel: "プラグイン ID",
      slugLabel: "スラッグ",
      versionLabel: "バージョン / チャンネル",
      sourceRevisionLabel: "ソースコミット SHA",
      artifactSizeLabel: "JAR サイズ / SHA-256",
      l2AuditTitle: "L2 バイトコード静的権限監査",
      scannedClassesLabel: "検査済み .class 数",
      riskLevelLabel: "リスクレベル",
      riskLevelLabels: {
        low: "低 (Low)",
        medium: "中 (Medium)",
        high: "高 (High)",
      },
      undeclaredCapabilitiesWarning: "未宣言の機密 API 呼び出しが検出されました：",
      declaredPermissionsTitle: "宣言された権限",
      noPermissionsDeclared: "権限は宣言されていません。",
      bytecodeFindingsTitle: "検出されたバイトコード参照",
      noSensitiveCallsDetected: "機密 API 呼び出しは検出されませんでした。",
      matchedPermissionLabel: "宣言一致",
      unmatchedCapabilityLabel: "未宣言",
      previewSectionTitle: "ディレクトリカード・README プレビュー",
      cardPreviewLabel: "カードプレビュー",
      readmePreviewLabel: "サーバー無害化済み README プレビュー",
      noReadmeAvailable: "このリリースには README が含まれていません。",
      acknowledgementTitle: "提出者の同意事項",
      acknowledgementText:
        "私はこのリポジトリの正当な公開権限を保持していること、掲載が公式セキュリティ認証や継続的互換性保証を伴わない「審査済みサードパーティ」掲載であることを理解し、公開済みリリースの同名 .jar アセットを差し替えないことを約束します。",
      submitPrButton: "審査 Pull Request を提出",
      submittingPr: "審査 PR を作成中...",
      submitSuccessTitle: "提出が完了しました",
      submitSuccessPrLink: "GitHub で Pull Request を開く",
      submitActionLabels: {
        created: "新規作成",
        updated: "更新済み",
      },
      simulatedPrBannerTitle: "Dev Mock シミュレーションプレビュー",
      simulatedPrBannerBody:
        "開発プレビューモードのため実際の PR は作成されません。以下に生成される PR のタイトルと本文を表示します。",
      prTitleLabel: "PR タイトル",
      prBranchLabel: "ブランチ",
      prFileLabel: "マニフェストパス",
      prBodyLabel: "PR 本文",
      goToDashboard: "マイ提出一覧へ移動",
      submitAnother: "別のリリースを提出する",
    },
    dashboard: {
      pageTitle: "パブリッシャーコンソール",
      pageSubtitle: "提出した審査 Pull Request と、あなたの GitHub アカウントに紐づく掲載プラグインを管理します。",
      loginRequiredTitle: "コンソールを表示するにはサインインしてください",
      loginRequiredBody:
        "GitHub でサインインすると、審査中の PR 状況や所有登録済みプラグインの新バージョン提出を行えます。",
      loadingDashboard: "提出履歴と登録済みプラグインを読み込み中...",
      refreshButton: "更新",
      prsSectionTitle: "審査中および最近の提出 PR",
      prIntegrationNotice:
        "この環境では GitHub App 連携が設定されていないため、ローカルに登録済みの所有プラグインのみ表示されています。",
      noPrsYet: "このアカウントに関連する提出 Pull Request はまだありません。",
      prStatusLabels: {
        open: "審査中 (Open)",
        merged: "マージ済み (Merged)",
        closed: "クローズ (Closed)",
      },
      prUpdatedLabel: "更新日時",
      openPrOnGitHub: "PR を開く",
      claimedSectionTitle: "所有登録済みディレクトリプラグイン",
      noClaimedPlugins: "この GitHub アカウントに紐づく掲載プラグインはまだありません。",
      claimedAtLabel: "登録日時",
      releasesCountLabel: "有効リリース数",
      submitNewReleaseButton: "新バージョンを提出",
      viewListingButton: "詳細ページ",
      submitFirstPluginButton: "最初のプラグインを提出",
    },
    submissionErrors: {
      unauthorized: "認証が必要かセッションの有効期限が切れています。再度サインインしてください。",
      csrf_origin_mismatch: "同一オリジン検証に失敗しました。ページを再読み込みしてください。",
      invalid_repository: "リポジトリ形式が無効です。owner/repo または https://github.com/owner/repo を指定してください。",
      invalid_release_tag: "対象リリースタグを選択してください。",
      invalid_preview_overrides: "サポート URL は HTTPS、サマリー上書きは文字列である必要があります。",
      publisher_verification_failed: "このリポジトリに対する公開権限を確認できませんでした。",
      release_not_found: "該当タグの非ドラフトリリースが見つかりませんでした。",
      asset_not_found: "選択された .jar アセットが見つかりませんでした。",
      ambiguous_asset: "複数の .jar アセットが存在します。1 つを明示的に選択してください。",
      preflight_failed: "JAR が事前検査の契約またはセキュリティ要件を満たしていません。",
      submission_rate_limited: "オープン中の提出 PR 数が上限に達しています。",
      github_oauth_config_missing: "サーバーに GitHub OAuth 認証情報が設定されていません。",
      github_app_config_missing: "サーバーに提出ボット用 GitHub App が設定されていません。",
      github_api_error: "GitHub API リクエストに失敗しました。しばらくしてから再試行してください。",
      untrusted_download_host: "ダウンロードリダイレクト先が信頼されたホストではありません。",
      redirect_limit_exceeded: "ダウンロードのリダイレクト回数が上限を超えました。",
      artifact_size_invalid: "JAR ファイルサイズが許可範囲（1 B〜16 MiB）外です。",
      tag_resolution_failed: "リリースタグの 40 文字コミット SHA を解決できませんでした。",
      unknown: "リクエストの処理中に予期しないエラーが発生しました。",
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
