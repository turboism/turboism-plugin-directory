export type SiteLanguage = 'en' | 'zh' | 'ja' | 'ko';
export function persistLanguagePreference(language: SiteLanguage): void;
export function readLanguagePreference(): SiteLanguage | null;
