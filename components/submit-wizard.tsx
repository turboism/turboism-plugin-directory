"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CheckCircle2,
  FileCheck2,
  GitPullRequest,
  Loader2,
  LogIn,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { trustBadgeClassName } from "@/components/directory-browser";
import { useLanguage } from "@/components/language-provider";
import {
  AUTH_CHANGED_EVENT,
  type AuthSessionState,
  type EligibleRepositoryRelease,
  type PreflightIssue,
  type PreflightSuccessResponse,
  type PublicRepositorySummary,
  type ReleasesLookupResponse,
  type SubmissionApiErrorPayload,
  type SubmitPrSuccessResponse,
  buildGitHubLoginHref,
  fetchAuthSession,
  formatByteSize,
  resolveSubmissionErrorMessage,
} from "@/lib/auth/client";
import { withBasePath } from "@/lib/base-path.mjs";
import { resolveLocalizedPlugin } from "@/lib/directory-view.mjs";

const SUMMARY_OVERRIDE_LOCALES = ["en", "zh", "ja", "ko"] as const;
type SummaryOverrideLocale = (typeof SUMMARY_OVERRIDE_LOCALES)[number];

interface ManifestReleaseSummary {
  version: string;
  channel: string;
  turboismApi: string;
  requiresCubism: boolean;
  cubismVersions: string[];
  artifact: {
    fileName: string;
    sha256: string;
    size: number;
    url: string;
  };
}

function readStringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readManifestReleaseSummary(release: Record<string, unknown>): ManifestReleaseSummary {
  const artifactRaw =
    typeof release.artifact === "object" && release.artifact !== null
      ? (release.artifact as Record<string, unknown>)
      : {};
  const cubismRaw = Array.isArray(release.cubismVersions)
    ? release.cubismVersions.filter((item): item is string => typeof item === "string")
    : [];
  return {
    version: readStringField(release, "version"),
    channel: readStringField(release, "channel"),
    turboismApi: readStringField(release, "turboismApi"),
    requiresCubism: Boolean(release.requiresCubism),
    cubismVersions: cubismRaw,
    artifact: {
      fileName: readStringField(artifactRaw, "fileName"),
      sha256: readStringField(artifactRaw, "sha256"),
      size: typeof artifactRaw.size === "number" ? artifactRaw.size : 0,
      url: readStringField(artifactRaw, "url"),
    },
  };
}

function riskBadgeClassName(riskLevel: string): string {
  if (riskLevel === "high") return "border-rose-300 bg-rose-50 text-rose-800";
  if (riskLevel === "medium") return "border-amber-300 bg-amber-50 text-amber-900";
  return "border-emerald-300 bg-emerald-50 text-emerald-800";
}

/**
 * Interactive two-step third-party plugin submission wizard (/submit):
 * Step 1 selects a verified repository, release, and optional overrides to run preflight;
 * Step 2 inspects L1/L2 audit findings, live previews, and submits the GitOps review PR.
 */
export function SubmitWizard() {
  const { copy, language, catalogLocale } = useLanguage();
  const searchParams = useSearchParams();
  const repoQueryParam = searchParams.get("repo")?.trim() ?? "";

  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  const [repos, setRepos] = useState<PublicRepositorySummary[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [reposError, setReposError] = useState<string | null>(null);

  const [repoInput, setRepoInput] = useState(repoQueryParam);
  const [releasesLoading, setReleasesLoading] = useState(false);
  const [releasesError, setReleasesError] = useState<{ code?: string; message: string } | null>(null);
  const [releasesData, setReleasesData] = useState<ReleasesLookupResponse | null>(null);

  const [selectedTag, setSelectedTag] = useState("");
  const [selectedAssetName, setSelectedAssetName] = useState("");
  const [slugOverride, setSlugOverride] = useState("");
  const [supportUrl, setSupportUrl] = useState("");
  const [summaryOverrides, setSummaryOverrides] = useState<Record<SummaryOverrideLocale, string>>({
    en: "",
    zh: "",
    ja: "",
    ko: "",
  });

  const [step, setStep] = useState<1 | 2>(1);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflightError, setPreflightError] = useState<{
    message: string;
    issues: PreflightIssue[];
  } | null>(null);
  const [preflightResult, setPreflightResult] = useState<PreflightSuccessResponse | null>(null);

  const [activeReadmeLocale, setActiveReadmeLocale] = useState<string>("en");
  const [acknowledged, setAcknowledged] = useState(false);
  const [submittingPr, setSubmittingPr] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitResult, setSubmitResult] = useState<SubmitPrSuccessResponse | null>(null);

  const autoLoadedRepoRef = useRef<string>("");

  useEffect(() => {
    const controller = new AbortController();
    const syncSession = (signal?: AbortSignal) => {
      void fetchAuthSession(signal)
        .then((next) => {
          if (!signal?.aborted) {
            setSession(next);
          }
        })
        .catch(() => {
          if (!signal?.aborted) {
            setSession(null);
          }
        })
        .finally(() => {
          if (!signal?.aborted) {
            setSessionLoading(false);
          }
        });
    };

    syncSession(controller.signal);

    const handleRefresh = () => {
      syncSession();
    };
    window.addEventListener(AUTH_CHANGED_EVENT, handleRefresh);
    window.addEventListener("pageshow", handleRefresh);
    return () => {
      controller.abort();
      window.removeEventListener(AUTH_CHANGED_EVENT, handleRefresh);
      window.removeEventListener("pageshow", handleRefresh);
    };
  }, []);

  const loadUserRepositories = useCallback(async () => {
    setReposLoading(true);
    setReposError(null);
    try {
      const response = await fetch(withBasePath("/api/submissions/repos"), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      });
      if (!response.ok) {
        const errPayload = (await response.json().catch(() => ({}))) as SubmissionApiErrorPayload;
        setReposError(
          resolveSubmissionErrorMessage(
            copy,
            errPayload.error?.code,
            errPayload.error?.message,
          ),
        );
        return;
      }
      const data = (await response.json()) as { repositories?: PublicRepositorySummary[] };
      setRepos(Array.isArray(data.repositories) ? data.repositories : []);
    } catch {
      setReposError(copy.submissionErrors.unknown);
    } finally {
      setReposLoading(false);
    }
  }, [copy]);

  const loadReleasesForRepo = useCallback(
    async (targetRepo: string) => {
      const trimmed = targetRepo.trim();
      if (!trimmed) return;
      setReleasesLoading(true);
      setReleasesError(null);
      setReleasesData(null);
      setPreflightError(null);
      setPreflightResult(null);
      setSubmitResult(null);
      setStep(1);

      try {
        const response = await fetch(
          withBasePath(`/api/submissions/releases?repo=${encodeURIComponent(trimmed)}`),
          {
            method: "GET",
            credentials: "same-origin",
            cache: "no-store",
          },
        );
        if (!response.ok) {
          const errPayload = (await response.json().catch(() => ({}))) as SubmissionApiErrorPayload;
          const code = errPayload.error?.code;
          setReleasesError({
            code,
            message: resolveSubmissionErrorMessage(copy, code, errPayload.error?.message),
          });
          return;
        }
        const data = (await response.json()) as ReleasesLookupResponse;
        setReleasesData(data);
        if (data.catalogedPlugin?.slug) {
          setSlugOverride(data.catalogedPlugin.slug);
        } else {
          setSlugOverride("");
        }
        const firstRelease = data.releases[0];
        if (firstRelease) {
          setSelectedTag(firstRelease.tagName);
          setSelectedAssetName(firstRelease.assets[0]?.name ?? "");
        } else {
          setSelectedTag("");
          setSelectedAssetName("");
        }
      } catch {
        setReleasesError({ message: copy.submissionErrors.unknown });
      } finally {
        setReleasesLoading(false);
      }
    },
    [copy],
  );

  useEffect(() => {
    if (!session?.authenticated) return;
    const timer = window.setTimeout(() => {
      void loadUserRepositories();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session?.authenticated, loadUserRepositories]);

  useEffect(() => {
    if (!session?.authenticated || !repoQueryParam) return;
    if (autoLoadedRepoRef.current === repoQueryParam) return;
    autoLoadedRepoRef.current = repoQueryParam;
    const timer = window.setTimeout(() => {
      setRepoInput(repoQueryParam);
      void loadReleasesForRepo(repoQueryParam);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session?.authenticated, repoQueryParam, loadReleasesForRepo]);

  const selectedRelease: EligibleRepositoryRelease | null = useMemo(
    () => releasesData?.releases.find((item) => item.tagName === selectedTag) ?? null,
    [releasesData, selectedTag],
  );

  const handleReleaseChange = (nextTag: string) => {
    setSelectedTag(nextTag);
    const matched = releasesData?.releases.find((item) => item.tagName === nextTag);
    setSelectedAssetName(matched?.assets[0]?.name ?? "");
    setPreflightError(null);
  };

  const buildRequestPayload = () => {
    const cleanSummaryOverrides: Record<string, string> = {};
    for (const loc of SUMMARY_OVERRIDE_LOCALES) {
      const val = summaryOverrides[loc].trim();
      if (val.length > 0) {
        cleanSummaryOverrides[loc] = val;
      }
    }
    return {
      repository: releasesData?.repository.fullName ?? repoInput.trim(),
      tag: selectedTag,
      assetFileName: selectedAssetName,
      slug: slugOverride.trim() || undefined,
      supportUrl: supportUrl.trim() || undefined,
      summaryOverrides:
        Object.keys(cleanSummaryOverrides).length > 0 ? cleanSummaryOverrides : undefined,
    };
  };

  const handleRunPreflight = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedTag || !selectedAssetName) return;

    setPreflightLoading(true);
    setPreflightError(null);
    setSubmitError(null);
    setSubmitResult(null);
    setAcknowledged(false);

    try {
      const response = await fetch(withBasePath("/api/submissions/preflight"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestPayload()),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | PreflightSuccessResponse
        | SubmissionApiErrorPayload;

      if (!response.ok || !("ok" in payload) || !payload.ok) {
        const errObj = "error" in payload ? payload.error : undefined;
        setPreflightError({
          message: resolveSubmissionErrorMessage(copy, errObj?.code, errObj?.message),
          issues: Array.isArray(errObj?.details?.issues) ? errObj.details.issues : [],
        });
        return;
      }

      setPreflightResult(payload);
      const availableLocales = Object.keys(payload.preview.readmesHtml);
      if (availableLocales.includes(language)) {
        setActiveReadmeLocale(language);
      } else if (availableLocales.includes("en")) {
        setActiveReadmeLocale("en");
      } else if (availableLocales[0]) {
        setActiveReadmeLocale(availableLocales[0]);
      }
      setStep(2);
    } catch {
      setPreflightError({ message: copy.submissionErrors.unknown, issues: [] });
    } finally {
      setPreflightLoading(false);
    }
  };

  const handleSubmitPr = async () => {
    if (!acknowledged || !preflightResult) return;

    setSubmittingPr(true);
    setSubmitError(null);
    try {
      const response = await fetch(withBasePath("/api/submissions/submit"), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildRequestPayload()),
      });
      const payload = (await response.json().catch(() => ({}))) as
        | SubmitPrSuccessResponse
        | SubmissionApiErrorPayload;

      if (!response.ok || !("ok" in payload) || !payload.ok) {
        const errObj = "error" in payload ? payload.error : undefined;
        setSubmitError(resolveSubmissionErrorMessage(copy, errObj?.code, errObj?.message));
        return;
      }

      setSubmitResult(payload);
    } catch {
      setSubmitError(copy.submissionErrors.unknown);
    } finally {
      setSubmittingPr(false);
    }
  };

  const resetWizardForAnother = () => {
    setStep(1);
    setPreflightResult(null);
    setPreflightError(null);
    setSubmitResult(null);
    setSubmitError(null);
    setAcknowledged(false);
  };

  const loginHref = buildGitHubLoginHref(
    repoQueryParam ? `/submit?repo=${encodeURIComponent(repoQueryParam)}` : "/submit",
  );
  const devMockHref = buildGitHubLoginHref(
    repoQueryParam ? `/submit?repo=${encodeURIComponent(repoQueryParam)}` : "/submit",
    { mock: true },
  );

  return (
    <section className="container mx-auto max-w-5xl px-4 py-10 md:px-8">
      <div className="mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--tb-muted)] hover:text-[var(--tb-violet)] transition-colors mb-4"
        >
          <ArrowLeft size={15} />
          {copy.backToDirectory}
        </Link>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--tb-ink)] mb-2">
          {copy.submit.pageTitle}
        </h1>
        <p className="text-base text-[var(--tb-muted)] max-w-3xl leading-relaxed">
          {copy.submit.pageSubtitle}
        </p>
      </div>

      {sessionLoading ? (
        <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-8 flex items-center gap-3 text-sm text-[var(--tb-muted)]">
          <Loader2 size={18} className="animate-spin text-[var(--tb-violet)]" />
          {copy.auth.loadingSession}
        </div>
      ) : !session?.authenticated ? (
        <div className="space-y-6">
          <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm">
            <h2 className="text-xl font-bold text-[var(--tb-ink)] mb-2">
              {copy.submit.loginRequiredTitle}
            </h2>
            <p className="text-sm text-[var(--tb-muted)] leading-relaxed mb-6">
              {copy.submit.loginRequiredIntro}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
              <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-5">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-violet)] mb-3">
                  {copy.submit.eligibilityTitle}
                </h3>
                <ul className="space-y-2 text-sm text-[var(--tb-ink)] list-disc pl-5">
                  {copy.submit.eligibilityItems.map((item) => (
                    <li key={item} className="leading-relaxed">
                      {item}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-soft)]/70 p-5">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-violet)] mb-3">
                  {copy.submit.minimalPermissionsTitle}
                </h3>
                <p className="text-sm text-[var(--tb-ink)] leading-relaxed">
                  {copy.submit.minimalPermissionsBody}
                </p>
              </div>
            </div>

            {!session?.capabilities.oauthConfigured && !session?.capabilities.devMockEnabled ? (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                {copy.auth.oauthUnavailable}
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <a
                  href={loginHref}
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-[var(--tb-deep)] transition-colors"
                >
                  <LogIn size={16} />
                  {copy.auth.signInWithGitHub}
                </a>

                {session?.capabilities.devMockEnabled && (
                  <a
                    href={devMockHref}
                    className="inline-flex items-center gap-2 rounded-full border border-amber-400 bg-amber-50 px-5 py-3 text-sm font-medium text-amber-950 hover:bg-amber-100 transition-colors"
                  >
                    <Sparkles size={16} className="text-amber-700" />
                    <span>{copy.auth.devPreviewSignIn}</span>
                    <span className="rounded bg-amber-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase">
                      {copy.auth.devPreviewBadge}
                    </span>
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            <div
              className={`rounded-full border px-4 py-1.5 text-xs font-mono font-semibold ${
                step === 1
                  ? "border-[var(--tb-violet)] bg-[var(--tb-soft)] text-[var(--tb-violet)]"
                  : "border-[var(--tb-border)] bg-white text-[var(--tb-muted)]"
              }`}
            >
              {copy.submit.step1Label}
            </div>
            <ArrowRight size={14} className="text-[var(--tb-muted)]" />
            <div
              className={`rounded-full border px-4 py-1.5 text-xs font-mono font-semibold ${
                step === 2
                  ? "border-[var(--tb-violet)] bg-[var(--tb-soft)] text-[var(--tb-violet)]"
                  : "border-[var(--tb-border)] bg-white text-[var(--tb-muted)]"
              }`}
            >
              {copy.submit.step2Label}
            </div>
          </div>

          {step === 1 && (
            <div className="space-y-6 rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold text-[var(--tb-ink)]">
                    {copy.submit.selectRepositoryLabel}
                  </h2>
                  <button
                    type="button"
                    onClick={() => void loadUserRepositories()}
                    disabled={reposLoading}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--tb-border)] px-3 py-1 text-xs font-medium text-[var(--tb-muted)] hover:border-[var(--tb-violet)] hover:text-[var(--tb-violet)] disabled:opacity-50 cursor-pointer"
                  >
                    <RefreshCw size={12} className={reposLoading ? "animate-spin" : ""} />
                    {copy.dashboard.refreshButton}
                  </button>
                </div>

                {reposError && (
                  <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
                    {reposError}
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="block space-y-1.5">
                    <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--tb-muted)]">
                      {copy.submit.repoDropdownLabel}
                    </span>
                    <select
                      value={
                        repos.some((r) => r.fullName === repoInput) ? repoInput : ""
                      }
                      onChange={(event) => {
                        const val = event.target.value;
                        if (!val) return;
                        setRepoInput(val);
                        void loadReleasesForRepo(val);
                      }}
                      disabled={reposLoading}
                      className="w-full rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-3.5 py-2.5 text-sm text-[var(--tb-ink)] focus:border-[var(--tb-violet)] focus:outline-none"
                    >
                      <option value="">
                        {reposLoading ? copy.submit.loadingRepos : copy.submit.repoDropdownPlaceholder}
                      </option>
                      {repos.map((repo) => (
                        <option key={repo.id} value={repo.fullName}>
                          {repo.fullName} {repo.isMock ? "(Dev Mock)" : ""}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="space-y-1.5">
                    <label htmlFor="manual-repo-input" className="block text-xs font-mono font-semibold uppercase tracking-wider text-[var(--tb-muted)]">
                      {copy.submit.manualRepoLabel}
                    </label>
                    <div className="flex gap-2">
                      <input
                        id="manual-repo-input"
                        type="text"
                        value={repoInput}
                        onChange={(event) => setRepoInput(event.target.value)}
                        placeholder={copy.submit.manualRepoPlaceholder}
                        className="flex-1 min-w-0 rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-3.5 py-2.5 text-sm font-mono text-[var(--tb-ink)] focus:border-[var(--tb-violet)] focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void loadReleasesForRepo(repoInput)}
                        disabled={!repoInput.trim() || releasesLoading}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--tb-violet)] px-4 py-2.5 text-sm font-medium text-white hover:bg-[var(--tb-deep)] disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {releasesLoading && <Loader2 size={14} className="animate-spin" />}
                        {copy.submit.loadReleasesButton}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {releasesLoading && (
                <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-soft)]/50 px-4 py-3 text-sm text-[var(--tb-muted)] flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin text-[var(--tb-violet)]" />
                  {copy.submit.loadingReleases}
                </div>
              )}

              {releasesError && (
                <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 space-y-2">
                  <div className="flex items-start gap-2.5 text-sm font-medium text-rose-900">
                    <AlertTriangle size={18} className="text-rose-600 shrink-0 mt-0.5" />
                    <span>{releasesError.message}</span>
                  </div>
                  {releasesError.code === "publisher_verification_failed" && (
                    <div className="ml-6 rounded-lg border border-rose-200 bg-white p-3 text-xs text-[var(--tb-ink)] space-y-1">
                      <p className="font-semibold">{copy.submit.publisherFailHelpTitle}</p>
                      <p className="text-[var(--tb-muted)] leading-relaxed">
                        {copy.submit.publisherFailHelpBody}
                      </p>
                    </div>
                  )}
                </div>
              )}

              {releasesData && (
                <form onSubmit={(event) => void handleRunPreflight(event)} className="space-y-6 pt-4 border-t border-[var(--tb-border)]">
                  <div className="flex flex-wrap items-center gap-2.5">
                    <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                      <CheckCircle2 size={14} />
                      {copy.submit.verifiedOwnerBadge}:{" "}
                      {copy.submit.verificationReasonLabels[releasesData.verificationReason] ??
                        releasesData.verificationReason}
                    </span>
                    <a
                      href={releasesData.repository.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 font-mono text-xs text-[var(--tb-violet)] hover:underline"
                    >
                      {releasesData.repository.fullName}
                      <ArrowUpRight size={13} />
                    </a>
                  </div>

                  {releasesData.catalogedPlugin && (
                    <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-soft)]/60 px-4 py-3 text-sm text-[var(--tb-ink)]">
                      {copy.submit.existingPluginNotice
                        .replace("{pluginId}", releasesData.catalogedPlugin.pluginId)
                        .replace("{slug}", releasesData.catalogedPlugin.slug)}
                    </div>
                  )}

                  {releasesData.releases.length === 0 ? (
                    <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
                      {copy.submit.noEligibleReleases}
                    </div>
                  ) : (
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <label className="block space-y-1.5">
                          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--tb-muted)]">
                            {copy.submit.selectReleaseLabel}
                          </span>
                          <select
                            value={selectedTag}
                            onChange={(event) => handleReleaseChange(event.target.value)}
                            className="w-full rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-3.5 py-2.5 text-sm font-mono text-[var(--tb-ink)] focus:border-[var(--tb-violet)] focus:outline-none"
                          >
                            {releasesData.releases.map((rel) => (
                              <option key={rel.id} value={rel.tagName}>
                                {rel.tagName} ({rel.channel} · {rel.publishedAt.slice(0, 10)})
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="block space-y-1.5">
                          <span className="text-xs font-mono font-semibold uppercase tracking-wider text-[var(--tb-muted)]">
                            {copy.submit.selectAssetLabel}
                          </span>
                          <select
                            value={selectedAssetName}
                            onChange={(event) => setSelectedAssetName(event.target.value)}
                            className="w-full rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-3.5 py-2.5 text-sm font-mono text-[var(--tb-ink)] focus:border-[var(--tb-violet)] focus:outline-none"
                          >
                            {(selectedRelease?.assets ?? []).map((asset) => (
                              <option key={asset.id} value={asset.name}>
                                {asset.name} ({formatByteSize(asset.size)})
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-5 space-y-4">
                        <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-muted)]">
                          {copy.submit.optionalFieldsTitle}
                        </h3>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <label className="block space-y-1">
                            <span className="text-xs font-medium text-[var(--tb-ink)]">
                              {copy.submit.slugOverrideLabel}
                            </span>
                            <input
                              type="text"
                              value={slugOverride}
                              onChange={(event) => setSlugOverride(event.target.value)}
                              disabled={Boolean(releasesData.catalogedPlugin)}
                              placeholder="my-plugin"
                              className="w-full rounded-xl border border-[var(--tb-border)] bg-white px-3 py-2 text-sm font-mono text-[var(--tb-ink)] disabled:bg-[var(--tb-soft)] disabled:text-[var(--tb-muted)] focus:border-[var(--tb-violet)] focus:outline-none"
                            />
                            <span className="block text-[11px] text-[var(--tb-muted)]">
                              {copy.submit.slugOverrideHint}
                            </span>
                          </label>

                          <label className="block space-y-1">
                            <span className="text-xs font-medium text-[var(--tb-ink)]">
                              {copy.submit.supportUrlLabel}
                            </span>
                            <input
                              type="url"
                              value={supportUrl}
                              onChange={(event) => setSupportUrl(event.target.value)}
                              placeholder="https://github.com/owner/repo/issues"
                              className="w-full rounded-xl border border-[var(--tb-border)] bg-white px-3 py-2 text-sm font-mono text-[var(--tb-ink)] focus:border-[var(--tb-violet)] focus:outline-none"
                            />
                            <span className="block text-[11px] text-[var(--tb-muted)]">
                              {copy.submit.supportUrlHint}
                            </span>
                          </label>
                        </div>

                        <div className="space-y-2">
                          <span className="block text-xs font-medium text-[var(--tb-ink)]">
                            {copy.submit.summaryOverridesLabel}
                          </span>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {SUMMARY_OVERRIDE_LOCALES.map((loc) => (
                              <label key={loc} className="flex items-center gap-2">
                                <span className="w-8 font-mono text-xs font-semibold uppercase text-[var(--tb-muted)]">
                                  {loc}
                                </span>
                                <input
                                  type="text"
                                  value={summaryOverrides[loc]}
                                  onChange={(event) =>
                                    setSummaryOverrides((prev) => ({
                                      ...prev,
                                      [loc]: event.target.value,
                                    }))
                                  }
                                  placeholder={copy.submit.summaryOverridePlaceholder}
                                  className="flex-1 rounded-lg border border-[var(--tb-border)] bg-white px-3 py-1.5 text-xs text-[var(--tb-ink)] focus:border-[var(--tb-violet)] focus:outline-none"
                                />
                              </label>
                            ))}
                          </div>
                        </div>
                      </div>

                      {preflightError && (
                        <div className="rounded-xl border border-rose-300 bg-rose-50 p-4 space-y-2">
                          <div className="flex items-start gap-2 text-sm font-semibold text-rose-900">
                            <ShieldAlert size={18} className="text-rose-600 shrink-0 mt-0.5" />
                            <span>
                              {copy.submit.preflightIssuesTitle}: {preflightError.message}
                            </span>
                          </div>
                          {preflightError.issues.length > 0 && (
                            <ul className="ml-6 space-y-1 text-xs font-mono text-rose-800 list-disc">
                              {preflightError.issues.map((issue, idx) => (
                                <li key={`${issue.path}-${idx}`}>
                                  <span className="font-semibold">{issue.path}</span>: {issue.message}
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}

                      <div className="flex justify-end">
                        <button
                          type="submit"
                          disabled={preflightLoading || !selectedTag || !selectedAssetName}
                          className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-[var(--tb-deep)] disabled:opacity-50 cursor-pointer"
                        >
                          {preflightLoading ? (
                            <Loader2 size={16} className="animate-spin" />
                          ) : (
                            <FileCheck2 size={16} />
                          )}
                          {preflightLoading
                            ? copy.submit.runningPreflight
                            : copy.submit.runPreflightButton}
                        </button>
                      </div>
                    </>
                  )}
                </form>
              )}
            </div>
          )}

          {step === 2 && preflightResult && (
            <Step2PreflightAndSubmit
              preflightResult={preflightResult}
              activeReadmeLocale={activeReadmeLocale}
              onSelectReadmeLocale={setActiveReadmeLocale}
              acknowledged={acknowledged}
              onToggleAcknowledged={setAcknowledged}
              submittingPr={submittingPr}
              submitError={submitError}
              submitResult={submitResult}
              onBack={() => setStep(1)}
              onSubmit={() => void handleSubmitPr()}
              onReset={resetWizardForAnother}
              catalogLocale={catalogLocale}
            />
          )}
        </div>
      )}
    </section>
  );
}

function Step2PreflightAndSubmit({
  preflightResult,
  activeReadmeLocale,
  onSelectReadmeLocale,
  acknowledged,
  onToggleAcknowledged,
  submittingPr,
  submitError,
  submitResult,
  onBack,
  onSubmit,
  onReset,
  catalogLocale,
}: {
  preflightResult: PreflightSuccessResponse;
  activeReadmeLocale: string;
  onSelectReadmeLocale: (locale: string) => void;
  acknowledged: boolean;
  onToggleAcknowledged: (checked: boolean) => void;
  submittingPr: boolean;
  submitError: string | null;
  submitResult: SubmitPrSuccessResponse | null;
  onBack: () => void;
  onSubmit: () => void;
  onReset: () => void;
  catalogLocale: string;
}) {
  const { copy } = useLanguage();
  const { manifest, preview, isFirstClaim } = preflightResult;
  const releaseSummary = useMemo(
    () => readManifestReleaseSummary(manifest.release),
    [manifest.release],
  );
  const localizedPreview = useMemo(
    () =>
      resolveLocalizedPlugin(
        {
          name: preview.card.name,
          summary: preview.card.summary,
          localizations: preview.localizations,
        },
        catalogLocale,
      ),
    [preview.card.name, preview.card.summary, preview.localizations, catalogLocale],
  );

  const readmeLocales = Object.keys(preview.readmesHtml);
  const activeHtml = preview.readmesHtml[activeReadmeLocale] ?? "";
  const { bytecodeAudit } = preview;

  return (
    <div className="space-y-6">
      {!submitResult && (
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--tb-muted)] hover:text-[var(--tb-violet)] cursor-pointer"
        >
          <ArrowLeft size={15} />
          {copy.submit.backToStep1}
        </button>
      )}

      {submitResult ? (
        <div className="rounded-2xl border border-emerald-300 bg-white p-6 md:p-8 shadow-sm space-y-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 size={24} className="text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-xl font-bold text-[var(--tb-ink)]">
                {copy.submit.submitSuccessTitle}
              </h2>
              {!submitResult.simulated && (
                <p className="text-sm text-[var(--tb-muted)] mt-1">
                  #{submitResult.pr.prNumber} ·{" "}
                  {copy.submit.submitActionLabels[submitResult.pr.action] ?? submitResult.pr.action} ·{" "}
                  <code className="font-mono text-xs">{submitResult.pr.filePath}</code>
                </p>
              )}
            </div>
          </div>

          {!submitResult.simulated ? (
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={submitResult.pr.prUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--tb-deep)] transition-colors"
              >
                <GitPullRequest size={16} />
                {copy.submit.submitSuccessPrLink}
                <ArrowUpRight size={15} />
              </a>
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-2 rounded-full border border-[var(--tb-border)] bg-white px-5 py-2.5 text-sm font-medium text-[var(--tb-ink)] hover:border-[var(--tb-violet)] hover:text-[var(--tb-violet)] transition-colors"
              >
                {copy.submit.goToDashboard}
              </Link>
              <button
                type="button"
                onClick={onReset}
                className="text-sm text-[var(--tb-muted)] hover:text-[var(--tb-ink)] underline ml-2 cursor-pointer"
              >
                {copy.submit.submitAnother}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 space-y-1">
                <p className="font-semibold">{copy.submit.simulatedPrBannerTitle}</p>
                <p className="text-amber-900">{copy.submit.simulatedPrBannerBody}</p>
              </div>

              <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-4 text-xs">
                <div className="md:col-span-2">
                  <dt className="font-mono uppercase text-[var(--tb-muted)] mb-1">
                    {copy.submit.prTitleLabel}
                  </dt>
                  <dd className="font-semibold text-sm text-[var(--tb-ink)]">
                    {submitResult.mockSimulatedPr.title}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono uppercase text-[var(--tb-muted)] mb-1">
                    {copy.submit.prBranchLabel}
                  </dt>
                  <dd className="font-mono text-[var(--tb-ink)]">
                    {submitResult.mockSimulatedPr.branchName}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono uppercase text-[var(--tb-muted)] mb-1">
                    {copy.submit.prFileLabel}
                  </dt>
                  <dd className="font-mono text-[var(--tb-ink)]">
                    {submitResult.mockSimulatedPr.filePath}
                  </dd>
                </div>
                <div className="md:col-span-2">
                  <dt className="font-mono uppercase text-[var(--tb-muted)] mb-1">
                    {copy.submit.prBodyLabel}
                  </dt>
                  <dd>
                    <pre className="whitespace-pre-wrap rounded-lg border border-[var(--tb-border)] bg-white p-3 font-mono text-xs text-[var(--tb-ink)] max-h-80 overflow-y-auto">
                      {submitResult.mockSimulatedPr.body}
                    </pre>
                  </dd>
                </div>
              </dl>

              <div className="flex flex-wrap items-center gap-3">
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--tb-deep)] transition-colors"
                >
                  {copy.submit.goToDashboard}
                </Link>
                <button
                  type="button"
                  onClick={onReset}
                  className="text-sm text-[var(--tb-muted)] hover:text-[var(--tb-ink)] underline cursor-pointer"
                >
                  {copy.submit.submitAnother}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-[var(--tb-ink)] flex items-center gap-2">
                <ShieldCheck size={20} className="text-emerald-600" />
                {copy.submit.l1ContractTitle}
              </h2>
              <span className="rounded-full border border-[var(--tb-border)] bg-[var(--tb-soft)] px-3 py-1 font-mono text-xs font-semibold text-[var(--tb-violet)]">
                {isFirstClaim ? copy.submit.firstClaimBadge : copy.submit.updateReleaseBadge}
              </span>
            </div>

            <dl className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-3.5">
                <dt className="text-xs font-mono uppercase text-[var(--tb-muted)] mb-1">
                  {copy.submit.pluginIdLabel}
                </dt>
                <dd className="font-mono text-xs font-semibold text-[var(--tb-ink)]">
                  {preview.card.id}
                </dd>
              </div>

              <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-3.5">
                <dt className="text-xs font-mono uppercase text-[var(--tb-muted)] mb-1">
                  {copy.submit.slugLabel}
                </dt>
                <dd className="font-mono text-xs font-semibold text-[var(--tb-ink)]">
                  /plugins/{preview.card.slug}
                </dd>
              </div>

              <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-3.5">
                <dt className="text-xs font-mono uppercase text-[var(--tb-muted)] mb-1">
                  {copy.submit.versionLabel}
                </dt>
                <dd className="font-mono text-xs text-[var(--tb-ink)]">
                  v{releaseSummary.version} ({releaseSummary.channel})
                </dd>
              </div>

              <div className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-3.5">
                <dt className="text-xs font-mono uppercase text-[var(--tb-muted)] mb-1">
                  {copy.turboismApiLabel} · {copy.cubismVersionsLabel}
                </dt>
                <dd className="font-mono text-xs text-[var(--tb-ink)]">
                  {releaseSummary.turboismApi} ·{" "}
                  {releaseSummary.requiresCubism && releaseSummary.cubismVersions.length > 0
                    ? releaseSummary.cubismVersions.join(", ")
                    : copy.cubismIndependent}
                </dd>
              </div>

              <div className="md:col-span-2 rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-3.5">
                <dt className="text-xs font-mono uppercase text-[var(--tb-muted)] mb-1">
                  {copy.submit.sourceRevisionLabel}
                </dt>
                <dd className="font-mono text-xs text-[var(--tb-ink)] break-all">
                  {manifest.repository.sourceRevision}
                </dd>
              </div>

              <div className="md:col-span-2 rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-3.5">
                <dt className="text-xs font-mono uppercase text-[var(--tb-muted)] mb-1">
                  {copy.submit.artifactSizeLabel} ({releaseSummary.artifact.fileName})
                </dt>
                <dd className="font-mono text-xs text-[var(--tb-ink)] break-all">
                  {formatByteSize(releaseSummary.artifact.size)} · SHA-256: {releaseSummary.artifact.sha256}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-[var(--tb-ink)]">
                {copy.submit.l2AuditTitle}
              </h2>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[var(--tb-border)] bg-[var(--tb-paper)] px-3 py-1 font-mono text-xs text-[var(--tb-ink)]">
                  {copy.submit.scannedClassesLabel}: {bytecodeAudit.scannedClassCount}
                </span>
                <span
                  className={`rounded-full border px-3 py-1 font-mono text-xs font-semibold ${riskBadgeClassName(bytecodeAudit.riskLevel)}`}
                >
                  {copy.submit.riskLevelLabel}:{" "}
                  {copy.submit.riskLevelLabels[bytecodeAudit.riskLevel] ?? bytecodeAudit.riskLevel}
                </span>
              </div>
            </div>

            {bytecodeAudit.undeclaredCapabilities.length > 0 && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                <span className="font-semibold">{copy.submit.undeclaredCapabilitiesWarning} </span>
                <span className="font-mono text-xs">
                  {bytecodeAudit.undeclaredCapabilities.join(", ")}
                </span>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="space-y-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-muted)]">
                  {copy.submit.declaredPermissionsTitle}
                </h3>
                {preview.permissions.length === 0 ? (
                  <p className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-4 py-3 text-xs text-[var(--tb-muted)]">
                    {copy.submit.noPermissionsDeclared}
                  </p>
                ) : (
                  <ul className="space-y-2">
                    {preview.permissions.map((perm) => (
                      <li
                        key={perm.id}
                        className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-3.5 py-2.5 text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <code className="font-mono font-semibold text-[var(--tb-ink)]">
                            {perm.id}
                          </code>
                          <span className="font-mono text-[11px] text-[var(--tb-violet)]">
                            {copy.permissionScopeLabels[perm.scope] ?? perm.scope}
                          </span>
                        </div>
                        <p className="text-[var(--tb-muted)]">{perm.reason}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-muted)]">
                  {copy.submit.bytecodeFindingsTitle}
                </h3>
                {bytecodeAudit.findings.length === 0 ? (
                  <p className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-4 py-3 text-xs text-[var(--tb-muted)]">
                    {copy.submit.noSensitiveCallsDetected}
                  </p>
                ) : (
                  <ul className="space-y-2 max-h-64 overflow-y-auto pr-1">
                    {bytecodeAudit.findings.map((finding, index) => (
                      <li
                        key={`${finding.className}-${finding.symbol}-${index}`}
                        className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] px-3.5 py-2.5 text-xs space-y-1"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="font-mono font-semibold text-[var(--tb-ink)]">
                            {finding.category}
                          </span>
                          <span
                            className={`rounded px-2 py-0.5 font-mono text-[10px] font-semibold ${
                              finding.declaredPermissionMatched
                                ? "bg-emerald-100 text-emerald-800"
                                : "bg-amber-100 text-amber-900"
                            }`}
                          >
                            {finding.declaredPermissionMatched
                              ? copy.submit.matchedPermissionLabel
                              : copy.submit.unmatchedCapabilityLabel}
                          </span>
                        </div>
                        <p className="font-mono text-[11px] text-[var(--tb-muted)] break-all">
                          {finding.className} → {finding.symbol}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm space-y-5">
            <h2 className="text-lg font-bold text-[var(--tb-ink)]">
              {copy.submit.previewSectionTitle}
            </h2>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="space-y-2">
                <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-muted)]">
                  {copy.submit.cardPreviewLabel}
                </h3>
                <article className="flex flex-col p-5 rounded-2xl border border-[var(--tb-border)] bg-[var(--tb-paper)]">
                  <div className="flex flex-wrap items-center gap-2 mb-3">
                    <span
                      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${trustBadgeClassName("reviewed-third-party")}`}
                    >
                      {copy.reviewed}
                    </span>
                    <span className="font-mono text-xs font-semibold uppercase tracking-wider text-[var(--tb-muted)]">
                      {copy.categoryNames[preview.card.category] ?? preview.card.category}
                    </span>
                  </div>
                  <h4 className="text-lg font-bold text-[var(--tb-ink)] mb-1.5">
                    {localizedPreview.name}
                  </h4>
                  <p className="text-sm text-[var(--tb-muted)] leading-relaxed mb-4">
                    {localizedPreview.summary}
                  </p>
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {preview.card.tags.slice(0, 3).map((tag) => (
                      <span
                        key={tag}
                        className="px-2 py-0.5 rounded text-[11px] font-medium bg-[var(--tb-soft)] text-[var(--tb-ink)] border border-[var(--tb-border)]"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="pt-3 border-t border-[var(--tb-border)] flex items-center justify-between text-xs font-mono text-[var(--tb-muted)]">
                    <span>v{preview.card.latestVersion}</span>
                    <span>{preview.card.license}</span>
                  </div>
                </article>
              </div>

              <div className="lg:col-span-2 space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--tb-muted)]">
                    {copy.submit.readmePreviewLabel}
                  </h3>
                  {readmeLocales.length > 0 && (
                    <div className="flex items-center gap-1">
                      {readmeLocales.map((loc) => (
                        <button
                          key={loc}
                          type="button"
                          onClick={() => onSelectReadmeLocale(loc)}
                          className={`rounded-md border px-2.5 py-1 font-mono text-xs uppercase cursor-pointer ${
                            activeReadmeLocale === loc
                              ? "border-[var(--tb-violet)] bg-[var(--tb-soft)] text-[var(--tb-violet)] font-semibold"
                              : "border-[var(--tb-border)] bg-white text-[var(--tb-muted)]"
                          }`}
                        >
                          {loc}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {activeHtml ? (
                  <div
                    className="prose prose-sm max-w-none rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-5 text-[var(--tb-ink)] max-h-96 overflow-y-auto [&>h1]:text-xl [&>h1]:font-bold [&>h2]:text-lg [&>h2]:font-semibold [&>p]:my-2 [&>ul]:list-disc [&>ul]:pl-5 [&_code]:font-mono [&_code]:text-xs [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:overflow-x-auto"
                    dangerouslySetInnerHTML={{ __html: activeHtml }}
                  />
                ) : (
                  <p className="rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-5 text-sm text-[var(--tb-muted)]">
                    {copy.submit.noReadmeAvailable}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm space-y-5">
            <h2 className="text-base font-bold text-[var(--tb-ink)]">
              {copy.submit.acknowledgementTitle}
            </h2>

            <label className="flex items-start gap-3 rounded-xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-4 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => onToggleAcknowledged(event.target.checked)}
                className="mt-1 h-4 w-4 accent-[var(--tb-violet)] shrink-0"
              />
              <span className="text-sm text-[var(--tb-ink)] leading-relaxed">
                {copy.submit.acknowledgementText}
              </span>
            </label>

            {submitError && (
              <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
                {submitError}
              </div>
            )}

            <div className="flex justify-end">
              <button
                type="button"
                onClick={onSubmit}
                disabled={!acknowledged || submittingPr}
                className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] px-6 py-3 text-sm font-medium text-white shadow-sm hover:bg-[var(--tb-deep)] disabled:opacity-50 cursor-pointer"
              >
                {submittingPr ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <GitPullRequest size={16} />
                )}
                {submittingPr ? copy.submit.submittingPr : copy.submit.submitPrButton}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
