"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowUpRight,
  FolderGit2,
  GitPullRequest,
  Loader2,
  LogIn,
  PlusCircle,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { trustBadgeClassName } from "@/components/directory-browser";
import { useLanguage } from "@/components/language-provider";
import {
  AUTH_CHANGED_EVENT,
  type AuthSessionState,
  type AuthorSubmissionPrItem,
  type SubmissionApiErrorPayload,
  type SubmissionsMineResponse,
  buildGitHubLoginHref,
  extractRepoFullName,
  fetchAuthSession,
  resolveSubmissionErrorMessage,
} from "@/lib/auth/client";
import { withBasePath } from "@/lib/base-path.mjs";
import type { PluginTrust } from "@/lib/directory";

const PR_VERSION_PATTERN = /\bv([0-9]+\.[0-9]+\.[0-9]+)\b/;

function resolvePrStatusKey(item: AuthorSubmissionPrItem): "merged" | "open" | "closed" {
  if (item.mergedAt) return "merged";
  return item.state === "open" ? "open" : "closed";
}

function prStatusBadgeClass(statusKey: "merged" | "open" | "closed"): string {
  if (statusKey === "merged") {
    return "border-[var(--tb-border)] bg-[var(--tb-soft)] text-[var(--tb-violet)]";
  }
  if (statusKey === "open") {
    return "border-emerald-300 bg-emerald-50 text-emerald-800";
  }
  return "border-slate-300 bg-slate-100 text-slate-700";
}

function extractTargetVersion(title: string): string | null {
  const match = PR_VERSION_PATTERN.exec(title);
  return match ? match[1] : null;
}

/**
 * Publisher Console (/dashboard) displaying the developer's submission PRs
 * and claimed third-party plugins with one-click new-release submission links.
 */
export function PublisherDashboard() {
  const { copy } = useLanguage();
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [data, setData] = useState<SubmissionsMineResponse | null>(null);
  const [loadingMine, setLoadingMine] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadMine = useCallback(async (signal?: AbortSignal) => {
    setLoadingMine(true);
    setError(null);
    try {
      const response = await fetch(withBasePath("/api/submissions/mine"), {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        signal,
      });
      if (!response.ok) {
        const errPayload = (await response.json().catch(() => ({}))) as SubmissionApiErrorPayload;
        if (!signal?.aborted) {
          setError(
            resolveSubmissionErrorMessage(
              copy,
              errPayload.error?.code,
              errPayload.error?.message,
            ),
          );
        }
        return;
      }
      const payload = (await response.json()) as SubmissionsMineResponse;
      if (!signal?.aborted) {
        setData(payload);
      }
    } catch {
      if (!signal?.aborted) {
        setError(copy.submissionErrors.unknown);
      }
    } finally {
      if (!signal?.aborted) {
        setLoadingMine(false);
      }
    }
  }, [copy]);

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

  useEffect(() => {
    if (!session?.authenticated) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void loadMine(controller.signal);
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [session?.authenticated, loadMine]);

  const activeData = session?.authenticated ? data : null;

  const loginHref = buildGitHubLoginHref("/dashboard");
  const devMockHref = buildGitHubLoginHref("/dashboard", { mock: true });

  return (
    <section className="container mx-auto max-w-5xl px-4 py-10 md:px-8">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-[var(--tb-muted)] hover:text-[var(--tb-violet)] transition-colors mb-4"
          >
            <ArrowLeft size={15} />
            {copy.backToDirectory}
          </Link>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-[var(--tb-ink)] mb-2">
            {copy.dashboard.pageTitle}
          </h1>
          <p className="text-base text-[var(--tb-muted)] max-w-2xl leading-relaxed">
            {copy.dashboard.pageSubtitle}
          </p>
        </div>

        {session?.authenticated && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => void loadMine()}
              disabled={loadingMine}
              className="inline-flex items-center gap-1.5 rounded-full border border-[var(--tb-border)] bg-white px-4 py-2 text-xs font-medium text-[var(--tb-ink)] hover:border-[var(--tb-violet)] hover:text-[var(--tb-violet)] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw size={14} className={loadingMine ? "animate-spin" : ""} />
              {copy.dashboard.refreshButton}
            </button>
            <Link
              href="/submit"
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tb-violet)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--tb-deep)] transition-colors"
            >
              <PlusCircle size={14} />
              {copy.auth.submitPluginAction}
            </Link>
          </div>
        )}
      </div>

      {sessionLoading ? (
        <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-8 flex items-center gap-3 text-sm text-[var(--tb-muted)]">
          <Loader2 size={18} className="animate-spin text-[var(--tb-violet)]" />
          {copy.auth.loadingSession}
        </div>
      ) : !session?.authenticated ? (
        <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm space-y-6">
          <div>
            <h2 className="text-xl font-bold text-[var(--tb-ink)] mb-2">
              {copy.dashboard.loginRequiredTitle}
            </h2>
            <p className="text-sm text-[var(--tb-muted)] max-w-2xl leading-relaxed">
              {copy.dashboard.loginRequiredBody}
            </p>
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
      ) : loadingMine && !activeData ? (
        <div className="rounded-2xl border border-[var(--tb-border)] bg-white p-8 flex items-center gap-3 text-sm text-[var(--tb-muted)]">
          <Loader2 size={18} className="animate-spin text-[var(--tb-violet)]" />
          {copy.dashboard.loadingDashboard}
        </div>
      ) : (
        <div className="space-y-8">
          {error && (
            <div className="rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-900">
              {error}
            </div>
          )}

          <section className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <GitPullRequest size={18} className="text-[var(--tb-violet)]" />
              <h2 className="text-lg font-bold text-[var(--tb-ink)]">
                {copy.dashboard.prsSectionTitle}
              </h2>
            </div>

            {activeData && !activeData.prIntegrationConfigured && (
              <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-950">
                {copy.dashboard.prIntegrationNotice}
              </div>
            )}

            {activeData && activeData.submissions.length === 0 ? (
              <p className="rounded-xl border border-dashed border-[var(--tb-border)] bg-[var(--tb-paper)] px-5 py-6 text-sm text-[var(--tb-muted)]">
                {copy.dashboard.noPrsYet}
              </p>
            ) : (
              <ul className="divide-y divide-[var(--tb-border)]">
                {(activeData?.submissions ?? []).map((item) => {
                  const statusKey = resolvePrStatusKey(item);
                  const targetVersion = extractTargetVersion(item.title);
                  return (
                    <li
                      key={item.number}
                      className="py-4 first:pt-0 last:pb-0 flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                    >
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${prStatusBadgeClass(statusKey)}`}
                          >
                            {copy.dashboard.prStatusLabels[statusKey] ?? item.state}
                          </span>
                          <span className="font-mono text-xs text-[var(--tb-muted)]">
                            #{item.number}
                          </span>
                          {targetVersion && (
                            <span className="rounded border border-[var(--tb-border)] bg-[var(--tb-paper)] px-2 py-0.5 font-mono text-[11px] text-[var(--tb-ink)]">
                              v{targetVersion}
                            </span>
                          )}
                          {item.slug && (
                            <span className="font-mono text-xs text-[var(--tb-violet)]">
                              /{item.slug}
                            </span>
                          )}
                        </div>
                        <p className="text-sm font-semibold text-[var(--tb-ink)]">{item.title}</p>
                        <p className="text-xs text-[var(--tb-muted)] font-mono">
                          {copy.dashboard.prUpdatedLabel}: {item.updatedAt.slice(0, 10)}
                        </p>
                      </div>

                      <a
                        href={item.htmlUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1.5 self-start md:self-center rounded-full border border-[var(--tb-border)] bg-[var(--tb-paper)] px-4 py-2 text-xs font-medium text-[var(--tb-ink)] hover:border-[var(--tb-violet)] hover:text-[var(--tb-violet)] transition-colors shrink-0"
                      >
                        {copy.dashboard.openPrOnGitHub}
                        <ArrowUpRight size={14} />
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--tb-border)] bg-white p-6 md:p-8 shadow-sm space-y-4">
            <div className="flex items-center gap-2">
              <FolderGit2 size={18} className="text-[var(--tb-violet)]" />
              <h2 className="text-lg font-bold text-[var(--tb-ink)]">
                {copy.dashboard.claimedSectionTitle}
              </h2>
            </div>

            {activeData && activeData.catalogedPlugins.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--tb-border)] bg-[var(--tb-paper)] p-6 text-center space-y-4">
                <p className="text-sm text-[var(--tb-muted)]">
                  {copy.dashboard.noClaimedPlugins}
                </p>
                <Link
                  href="/submit"
                  className="inline-flex items-center gap-2 rounded-full bg-[var(--tb-violet)] px-5 py-2.5 text-sm font-medium text-white hover:bg-[var(--tb-deep)] transition-colors"
                >
                  <PlusCircle size={15} />
                  {copy.dashboard.submitFirstPluginButton}
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {(activeData?.catalogedPlugins ?? []).map((plugin) => {
                  const ownerRepo = extractRepoFullName(plugin.repository);
                  const trustValue: PluginTrust =
                    plugin.trust === "official" ? "official" : "reviewed-third-party";
                  return (
                    <article
                      key={plugin.pluginId}
                      className="flex flex-col justify-between rounded-2xl border border-[var(--tb-border)] bg-[var(--tb-paper)] p-5 space-y-4"
                    >
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wider ${trustBadgeClassName(trustValue)}`}
                          >
                            {trustValue === "official" ? copy.official : copy.reviewed}
                          </span>
                          {plugin.latestVersion && (
                            <span className="rounded border border-[var(--tb-border)] bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--tb-ink)]">
                              v{plugin.latestVersion}
                            </span>
                          )}
                        </div>

                        <h3 className="text-lg font-bold text-[var(--tb-ink)]">{plugin.name}</h3>
                        <p className="font-mono text-xs text-[var(--tb-muted)] break-all">
                          {plugin.pluginId}
                        </p>

                        <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--tb-muted)]">
                          <span>
                            {copy.dashboard.releasesCountLabel}: {plugin.releasesCount}
                          </span>
                          <span>·</span>
                          <span>
                            {copy.dashboard.claimedAtLabel}: {plugin.claimedAt.slice(0, 10)}
                          </span>
                        </div>

                        <a
                          href={plugin.repository}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-xs text-[var(--tb-violet)] hover:underline"
                        >
                          {ownerRepo}
                          <ArrowUpRight size={13} />
                        </a>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-3 border-t border-[var(--tb-border)]">
                        <Link
                          href={`/submit?repo=${encodeURIComponent(ownerRepo)}`}
                          className="inline-flex items-center gap-1.5 rounded-full bg-[var(--tb-violet)] px-4 py-2 text-xs font-medium text-white hover:bg-[var(--tb-deep)] transition-colors"
                        >
                          <PlusCircle size={13} />
                          {copy.dashboard.submitNewReleaseButton}
                        </Link>
                        <Link
                          href={`/${plugin.slug}`}
                          className="inline-flex items-center gap-1.5 rounded-full border border-[var(--tb-border)] bg-white px-4 py-2 text-xs font-medium text-[var(--tb-ink)] hover:border-[var(--tb-violet)] hover:text-[var(--tb-violet)] transition-colors"
                        >
                          {copy.dashboard.viewListingButton}
                        </Link>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
