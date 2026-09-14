/** One preference cookie for all independently deployed Turboism sites.
 * Only this preference is migrated; authentication and other cookies are untouched.
 * Keep this function self-contained: the SDK adapter embeds it in static HTML.
 */
export function persistLanguagePreference(language) {
  if (typeof window === 'undefined' || !['en', 'zh', 'ja', 'ko'].includes(language)) return;
  const name = 'turboism-language';
  const host = window.location.hostname;
  const shared = host === 'turboism.dev' || host.endsWith('.turboism.dev');
  const domain = shared ? '; Domain=.turboism.dev' : '';
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  const paths = new Set(['/', '/docs', '/learn', '/plugins', '/thanks', '/sdk', '/download', '/sponsor']);
  const segments = window.location.pathname.split('/').filter(Boolean);
  for (let i = 1; i <= segments.length; i++) {
    const path = '/' + segments.slice(0, i).join('/');
    paths.add(path); paths.add(path + '/');
  }
  // Cookies with identical names but different host/path scopes otherwise shadow
  // the new shared value. Retire those legacy variants before writing the value.
  const scopes = shared ? ['', '; Domain=' + host, '; Domain=.turboism.dev'] : [''];
  for (const path of paths) for (const scope of new Set(scopes)) {
    document.cookie = `${name}=; Path=${path}; Max-Age=0; SameSite=Lax${scope}${secure}`;
  }
  document.cookie = `${name}=${language}; Path=/; Max-Age=31536000; SameSite=Lax${domain}${secure}`;
  try {
    for (const key of [name, 'turboism-interface-language', 'turboism.learn.locale']) window.localStorage.setItem(key, language);
  } catch { /* The shared cookie remains sufficient when storage is unavailable. */ }
  window.dispatchEvent(new CustomEvent('turboism:language', { detail: language }));
}

export function readLanguagePreference() {
  if (typeof window === 'undefined') return null;
  const valid = value => ['en', 'zh', 'ja', 'ko'].includes(value);
  const values = document.cookie.split(/;\s*/).filter(row => row.startsWith('turboism-language=')).map(row => row.slice('turboism-language='.length));
  const cookie = values.find(valid);
  if (cookie) return cookie;
  try {
    for (const key of ['turboism-language', 'turboism-interface-language', 'turboism.learn.locale']) {
      const value = window.localStorage.getItem(key);
      if (valid(value)) return value;
    }
  } catch { /* Browser language remains available without local storage. */ }
  const language = window.navigator?.language?.split('-')[0]?.toLowerCase();
  return valid(language) ? language : null;
}
