"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { FolderGit2, LogIn, LogOut, PlusCircle, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useLanguage } from "@/components/language-provider";
import {
  AUTH_CHANGED_EVENT,
  type AuthSessionState,
  buildGitHubLoginHref,
  fetchAuthSession,
  isSafeAvatarUrl,
  logoutAuthSession,
} from "@/lib/auth/client";

const PLUGIN_REQUEST_URL =
  "https://github.com/turboism/turboism-plugin-directory/issues/new?template=plugin-request.md";

/**
 * Renders the global Directory Publisher Bar with live GitHub OAuth session status,
 * quick navigation to /submit and /dashboard, and sign-out support.
 */
export function PublisherAuthBar() {
  const { copy } = useLanguage();
  const pathname = usePathname() || "/";
  const [session, setSession] = useState<AuthSessionState | null>(null);
  const [loading, setLoading] = useState(true);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const syncSession = (signal?: AbortSignal) => {
      void fetchAuthSession(signal)
        .then((nextSession) => {
          if (!signal?.aborted) {
            setSession(nextSession);
          }
        })
        .catch(() => {
          if (!signal?.aborted) {
            setSession(null);
          }
        })
        .finally(() => {
          if (!signal?.aborted) {
            setLoading(false);
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

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await logoutAuthSession();
      const nextSession = await fetchAuthSession().catch(() => null);
      setSession(nextSession);
    } finally {
      setSigningOut(false);
    }
  };

  const returnPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const loginHref = buildGitHubLoginHref(returnPath);

  return (
    <div className="tb-page-tools" role="region" aria-label={copy.auth.submitPluginAction}>
      <a
        className="tb-action"
        href={PLUGIN_REQUEST_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        {copy.request}
      </a>

      {loading ? (
        <div
          className="inline-flex min-h-[42px] min-w-[220px] items-center justify-center rounded-[5px] border border-[var(--tb-border)] bg-[var(--tb-soft)] px-3 text-xs text-[var(--tb-muted)]"
          aria-busy="true"
        >
          {copy.auth.loadingSession}
        </div>
      ) : session?.authenticated && session.user ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex min-h-[42px] items-center gap-2 rounded-[5px] border border-[var(--tb-border)] bg-white px-3 text-xs font-medium text-[var(--tb-ink)]">
            {isSafeAvatarUrl(session.user.avatarUrl) ? (
              <Image
                src={session.user.avatarUrl}
                alt={session.user.login}
                width={20}
                height={20}
                unoptimized
                className="h-5 w-5 rounded-full border border-[var(--tb-border)] object-cover"
              />
            ) : (
              <User size={14} className="text-[var(--tb-violet)]" />
            )}
            <span className="font-mono">@{session.user.login}</span>
          </span>

          <Link
            href="/dashboard"
            className={`tb-action ${pathname === "/dashboard" ? "bg-[var(--tb-soft)] border-[var(--tb-violet)] font-semibold" : ""}`}
          >
            <FolderGit2 size={14} />
            {copy.auth.mySubmissions}
          </Link>

          <Link
            href="/submit"
            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-[5px] border border-[var(--tb-violet)] bg-[var(--tb-violet)] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--tb-deep)]"
          >
            <PlusCircle size={14} />
            {copy.auth.submitPluginAction}
          </Link>

          <button
            type="button"
            onClick={() => void handleSignOut()}
            disabled={signingOut}
            className="tb-action disabled:opacity-60"
          >
            <LogOut size={14} />
            {signingOut ? copy.auth.signingOut : copy.auth.signOut}
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/submit" className="tb-action">
            <PlusCircle size={14} />
            {copy.nominate}
          </Link>
          <a
            href={loginHref}
            className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-[5px] border border-[var(--tb-violet)] bg-[var(--tb-violet)] px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-[var(--tb-deep)]"
          >
            <LogIn size={14} />
            {copy.auth.signInWithGitHub}
          </a>
        </div>
      )}
    </div>
  );
}
