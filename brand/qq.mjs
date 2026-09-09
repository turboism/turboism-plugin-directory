/** Shared QQ join UI for React pages and static SDK HTML. No network until a user clicks.
 * Penguin path: Simple Icons (CC0), icons/qq.svg, blob 8690b359c7b19e5b623c08501f5916a8b4bb3765.
 * Native URIs are best-effort group-card requests, NOT signed invitations or proof of joining.
 */
export const QQ_GROUP = '726739398';
const QQ_ICON = 'M21.395 15.035a40 40 0 0 0-.803-2.264l-1.079-2.695c.001-.032.014-.562.014-.836C19.526 4.632 17.351 0 12 0S4.474 4.632 4.474 9.241c0 .274.013.804.014.836l-1.08 2.695a39 39 0 0 0-.802 2.264c-1.021 3.283-.69 4.643-.438 4.673.54.065 2.103-2.472 2.103-2.472 0 1.469.756 3.387 2.394 4.771-.612.188-1.363.479-1.845.835-.434.32-.379.646-.301.778.343.578 5.883.369 7.482.189 1.6.18 7.14.389 7.483-.189.078-.132.132-.458-.301-.778-.483-.356-1.233-.646-1.846-.836 1.637-1.384 2.393-3.302 2.393-4.771 0 0 1.563 2.537 2.103 2.472.251-.03.581-1.39-.438-4.673';
const QQ_TEXT = {
  zh: { label:'加入 Turboism QQ 群', title:'一起聊聊创作', subtitle:'Turboism QQ 交流群', copy:'复制群号', open:'打开 QQ 加群', hint:'未能打开？在 QQ 中搜索群号，申请加入即可', copied:'群号已复制', failed:'请选中群号，手动复制', close:'关闭', waiting:'已尝试打开 QQ，未跳转时可复制群号' },
  en: { label:'Join the Turboism QQ group', title:'A place to create together', subtitle:'Turboism community on QQ', copy:'Copy ID', open:'Open in QQ', hint:'No app opened? Search this group ID in QQ and request to join', copied:'Group ID copied', failed:'Select the group ID and copy it manually', close:'Close', waiting:'Opening QQ was requested. You can also copy the group ID' },
  ja: { label:'Turboism の QQ グループに参加', title:'創作の話を、一緒に', subtitle:'Turboism QQ コミュニティ', copy:'番号をコピー', open:'QQ でグループを開く', hint:'開かない場合は QQ でこの番号を検索し、参加を申請してください', copied:'グループ番号をコピーしました', failed:'番号を選択して手動でコピーしてください', close:'閉じる', waiting:'QQ の起動を要求しました。番号をコピーすることもできます' }
};
const QQ_CSS = `.tb-qq-host,.tb-qq{display:inline-flex;position:relative;flex-shrink:0}.tb-qq-trigger[aria-expanded=true]{color:var(--tb-violet);background:var(--tb-soft)}.tb-qq-panel[hidden]{display:none!important}.tb-qq-panel{position:absolute;right:0;top:calc(100% + 16px);width:330px;max-height:calc(100dvh - var(--tb-header-height) - 32px);overflow:auto;padding:23px;background:var(--tb-paper);color:var(--tb-ink);border:1px solid var(--tb-border);border-radius:12px;box-shadow:0 16px 48px #30294b19;text-align:left;font-family:var(--tb-sans);z-index:80;animation:tb-qq-in .16s ease-out}.tb-qq-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.tb-qq-eyebrow{font-size:10px;letter-spacing:.14em;color:var(--tb-violet)}.tb-qq-close{display:grid;place-items:center;width:36px;height:36px;margin:-8px -9px -4px 0;background:none;border:0;border-radius:5px;color:var(--tb-muted);cursor:pointer}.tb-qq-close:hover{background:var(--tb-soft);color:var(--tb-violet)}.tb-qq-close svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.5}.tb-qq-panel h2{font:400 23px/1.5 var(--tb-display);letter-spacing:-.02em;margin:15px 0 5px;color:var(--tb-violet)}.tb-qq-subtitle{font-size:12px;color:var(--tb-muted);margin:0 0 20px;line-height:1.6}.tb-qq-number{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:7px 11px 7px 14px;background:var(--tb-soft);border-radius:6px}.tb-qq-number code{font:500 19px/1.5 var(--font-mono,monospace);letter-spacing:.06em;color:var(--tb-ink);user-select:all}.tb-qq-copy{font:500 11px/1.3 var(--tb-sans);min-height:40px;padding:8px;background:none;color:var(--tb-violet);border:0;cursor:pointer;border-radius:4px}.tb-qq-copy:hover{background:var(--tb-yellow)}.tb-qq-panel .tb-qq-open{display:flex;align-items:center;justify-content:space-between;gap:14px;min-height:46px;margin-top:16px;padding:12px 15px;background:var(--tb-violet);color:white;border-radius:6px;text-decoration:none;font-size:12px}.tb-qq-panel .tb-qq-open:hover{background:var(--tb-deep)}.tb-qq-hint{font-size:11px;line-height:1.85;color:var(--tb-muted);margin:15px 0 0}.tb-qq-status{font-size:11px;line-height:1.6;color:var(--tb-violet);min-height:18px;margin:8px 0 0}@keyframes tb-qq-in{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:translateY(0)}}@media(max-width:700px){.tb-qq-panel{position:fixed;top:calc(var(--tb-header-height) + 9px);left:16px;right:16px;width:auto;max-width:400px;margin-left:auto;padding:22px}}@media(prefers-reduced-motion:reduce){.tb-qq-panel{animation:none}}`;
export function qqLink(userAgent = '', now = Date.now()) {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return `mqqapi://card/show_pslcard?src_type=internal&version=1&uin=${QQ_GROUP}&card_type=group&source=qrcode`;
  const payload = JSON.stringify({ groupUin:Number(QQ_GROUP), timeStamp:Math.floor(now / 1000), authKey:'', auth:'' });
  const hex = Array.from(payload, c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
  return `tencent://groupwpa/?subcmd=all&param=${hex}`;
}
export function qqMarkup(locale = 'en') {
  const t = QQ_TEXT[locale] || QQ_TEXT.en;
  // Every interpolated value is our own constant. No user HTML or invitation tokens.
  return `<span class="tb-qq" data-tb-qq data-qq-locale="${QQ_TEXT[locale] ? locale : 'en'}"><style>${QQ_CSS}</style><a class="tb-icon tb-qq-trigger" data-qq-trigger href="${qqLink('Mobile')}" aria-label="${t.label}" title="${t.label}" aria-haspopup="dialog" aria-expanded="false" aria-controls="tb-qq-panel"><svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="${QQ_ICON}"/></svg></a><section class="tb-qq-panel" id="tb-qq-panel" role="dialog" aria-label="${t.subtitle}" tabindex="-1" hidden><div class="tb-qq-top"><span class="tb-qq-eyebrow">QQ COMMUNITY</span><button type="button" class="tb-qq-close" data-qq-close aria-label="${t.close}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6"/></svg></button></div><h2 data-qq-text="title">${t.title}</h2><p class="tb-qq-subtitle" data-qq-text="subtitle">${t.subtitle}</p><div class="tb-qq-number"><code data-qq-number>${QQ_GROUP}</code><button type="button" class="tb-qq-copy" data-qq-copy data-qq-text="copy">${t.copy}</button></div><a class="tb-qq-open" data-qq-launch href="${qqLink('Mobile')}"><span data-qq-text="open">${t.open}</span><span aria-hidden="true">↗</span></a><p class="tb-qq-hint" data-qq-text="hint">${t.hint}</p><p class="tb-qq-status" data-qq-status aria-live="polite"></p></section></span>`;
}
export function attachQQ(root) {
  const node = root.matches?.('[data-tb-qq]') ? root : root.querySelector('[data-tb-qq]');
  if (!node) return () => {};
  const doc = node.ownerDocument, win = doc.defaultView;
  const trigger = node.querySelector('[data-qq-trigger]'), panel = node.querySelector('[role=dialog]');
  const copy = node.querySelector('[data-qq-copy]'), close = node.querySelector('[data-qq-close]');
  const launch = node.querySelector('[data-qq-launch]'), status = node.querySelector('[data-qq-status]');
  let t = QQ_TEXT[node.dataset.qqLocale] || QQ_TEXT.en, disposed = false;
  const localize = () => {
    const language = (node.closest('header')?.lang || doc.documentElement.lang || node.dataset.qqLocale).split('-')[0];
    t = QQ_TEXT[language] || QQ_TEXT.en;
    node.querySelectorAll('[data-qq-text]').forEach(el => { el.textContent = t[el.dataset.qqText]; });
    trigger.setAttribute('aria-label', t.label); trigger.title = t.label;
    panel.setAttribute('aria-label', t.subtitle); close.setAttribute('aria-label', t.close); status.textContent = '';
  };
  const updateLink = () => { trigger.href = launch.href = qqLink(win.navigator.userAgent); };
  const hide = (restore = false) => { panel.hidden = true; trigger.setAttribute('aria-expanded', 'false'); if (restore) trigger.focus(); };
  const click = event => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button > 0) return;
    if (!panel.hidden) { event.preventDefault(); hide(true); return; }
    updateLink(); panel.hidden = false; trigger.setAttribute('aria-expanded', 'true');
    status.textContent = t.waiting; panel.focus({preventScroll:true});
    // Let this explicit user gesture request the native URI. The fallback stays visible.
  };
  const outside = event => { if (!node.contains(event.target)) hide(); };
  const key = event => { if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); hide(true); } };
  const space = event => { if (event.key === ' ') { event.preventDefault(); trigger.click(); } };
  const onClose = () => hide(true);
  const onLaunch = () => { updateLink(); status.textContent = t.waiting; };
  const onCopy = async () => {
    try { await win.navigator.clipboard.writeText(QQ_GROUP); if (!disposed) status.textContent = t.copied; }
    catch { if (!disposed) { const range = doc.createRange(); range.selectNodeContents(node.querySelector('[data-qq-number]')); const selection = win.getSelection(); selection?.removeAllRanges(); selection?.addRange(range); status.textContent = t.failed; } }
  };
  const focusOut = event => { if (event.relatedTarget && !node.contains(event.relatedTarget)) hide(); };
  trigger.addEventListener('click', click); trigger.addEventListener('keydown', space);
  launch.addEventListener('click', onLaunch); copy.addEventListener('click', onCopy); close.addEventListener('click', onClose);
  doc.addEventListener('pointerdown', outside); doc.addEventListener('keydown', key); node.addEventListener('focusout', focusOut);
  const observer = new win.MutationObserver(localize);
  observer.observe(doc.documentElement, {attributes:true, attributeFilter:['lang']});
  const header = node.closest('header'); if (header) observer.observe(header, {attributes:true, attributeFilter:['lang']});
  localize(); updateLink();
  return () => { disposed = true; observer.disconnect(); trigger.removeEventListener('click', click); trigger.removeEventListener('keydown', space); launch.removeEventListener('click', onLaunch); copy.removeEventListener('click', onCopy); close.removeEventListener('click', onClose); doc.removeEventListener('pointerdown', outside); doc.removeEventListener('keydown', key); node.removeEventListener('focusout', focusOut); };
}
export function qqStaticScript() {
  return `(()=>{const QQ_GROUP=${JSON.stringify(QQ_GROUP)};const QQ_TEXT=${JSON.stringify(QQ_TEXT)};const qqLink=${qqLink.toString()};const attachQQ=${attachQQ.toString()};document.querySelectorAll('[data-tb-qq]').forEach(node=>attachQQ(node));})();`;
}
