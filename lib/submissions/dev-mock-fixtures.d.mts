import type { SubmissionManifest } from "./preflight.d.mts";

export const DEV_MOCK_USER: Readonly<{
  githubId: number;
  login: string;
  name: string;
  avatarUrl: string;
}>;

export const DEV_MOCK_REPO_OWNER: string;
export const DEV_MOCK_REPO_NAME: string;
export const DEV_MOCK_REPO_FULL_NAME: string;
export const DEV_MOCK_REPO_ID: number;
export const DEV_MOCK_REPO_URL: string;
export const DEV_MOCK_DEFAULT_BRANCH: string;
export const DEV_MOCK_PLUGIN_ID: string;
export const DEV_MOCK_PLUGIN_SLUG: string;
export const DEV_MOCK_PLUGIN_VERSION: string;
export const DEV_MOCK_RELEASE_TAG: string;
export const DEV_MOCK_ASSET_FILE_NAME: string;
export const DEV_MOCK_RELEASE_URL: string;
export const DEV_MOCK_ARTIFACT_URL: string;
export const DEV_MOCK_PUBLISHED_AT: string;
export const DEV_MOCK_SOURCE_REVISION: string;

export interface DevMockRepository {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  description: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
  disabled: boolean;
  updatedAt: string;
  owner: {
    id: number;
    login: string;
    type: string;
  };
  isMock: boolean;
}

export interface DevMockReleaseAsset {
  id: number;
  name: string;
  size: number;
  contentType: string;
  browserDownloadUrl: string;
}

export interface DevMockRelease {
  id: number;
  tagName: string;
  name: string;
  htmlUrl: string;
  prerelease: boolean;
  channel: "stable" | "preview";
  publishedAt: string;
  sourceRevision: string;
  isMock: boolean;
  assets: DevMockReleaseAsset[];
}

export interface DevMockSimulatedPr {
  simulated: true;
  directoryRepo: string;
  baseBranch: string;
  branchName: string;
  filePath: string;
  title: string;
  body: string;
  labels: string[];
  pluginId: string;
  slug: string;
  version: string;
}

export function buildDevMockJarBytes(): Buffer;
export function getDevMockUser(): { githubId: number; login: string; name: string; avatarUrl: string };
export function isDevMockRepository(fullName: string): boolean;
export function getDevMockRepositoryByFullName(fullName: string): DevMockRepository | null;
export function getDevMockRepositories(): DevMockRepository[];
export function getDevMockReleases(fullName: string): DevMockRelease[];
export function buildDevMockSimulatedPr(params: {
  manifest: SubmissionManifest;
  directoryRepo: string;
  baseBranch: string;
  title: string;
  body: string;
  labels: string[];
  branchName: string;
  filePath: string;
}): DevMockSimulatedPr;
