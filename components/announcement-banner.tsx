'use client';
import { useEffect, useRef, useState } from 'react';

// Single source of truth: www/public/announcement.txt, served from the apex domain.
const SOURCE = process.env.NEXT_PUBLIC_ANNOUNCEMENT_URL ?? 'https://turboism.dev/announcement.txt';
const MAX_LENGTH = 300;
const HEIGHT = 28;

const GAP = 48;
const SPEED = 50; // px per second

const CSS = `.tb-announcement{position:absolute;top:var(--tb-header-height,5rem);left:0;right:0;z-index:55;height:${HEIGHT}px;padding:0 16px;overflow:hidden;box-sizing:border-box;background:#F1EEF9;border-bottom:1px solid #E5E1EE;color:#30294B;font:12px/${HEIGHT - 1}px -apple-system,BlinkMacSystemFont,'Segoe UI','PingFang SC','Microsoft YaHei',sans-serif;text-align:center;white-space:nowrap}.tb-announcement-track{display:inline-flex}.tb-announcement-item{flex:none}.tb-announcement[data-scroll=true]{padding:0;text-align:left}.tb-announcement[data-scroll=true] .tb-announcement-item{padding-right:${GAP}px}.tb-announcement[data-scroll=true] .tb-announcement-track{animation:tb-announce var(--tb-announce-duration,20s) linear infinite}.tb-announcement:hover .tb-announcement-track,.tb-announcement:focus-within .tb-announcement-track{animation-play-state:paused}@keyframes tb-announce{to{transform:translateX(-50%)}}@media(max-width:700px){.tb-announcement{padding:0 12px}}@media(prefers-reduced-motion:reduce){.tb-announcement[data-scroll=true]{overflow-x:auto;scrollbar-width:none}.tb-announcement[data-scroll=true] .tb-announcement-track{animation:none}.tb-announcement[data-scroll=true] .tb-announcement-item+.tb-announcement-item{display:none}}body:has(.tb-announcement){--tb-announcement-height:${HEIGHT}px;padding-top:${HEIGHT}px}`;

// File format: one line per language, e.g. "en: Maintenance on Saturday" / "zh: 周六维护".
// Lines without a language prefix are shown to every language that has no line of its own.
const LINE = /^(en|zh|ja|ko)\s*[:：]\s*(.*)$/i;

function currentLocale() {
  const lang = (document.documentElement.lang || navigator.language || 'en').toLowerCase();
  return lang.slice(0, 2);
}

function pick(raw: string, locale: string) {
  const byLocale: Record<string, string> = {};
  const plain: string[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const match = LINE.exec(line.trim());
    if (match) byLocale[match[1].toLowerCase()] = match[2].trim();
    else if (line.trim()) plain.push(line.trim());
  }
  const text = byLocale[locale] || plain.join(' ') || byLocale.en || Object.values(byLocale)[0] || '';
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_LENGTH);
}

export function AnnouncementBanner() {
  const [raw, setRaw] = useState('');
  const [locale, setLocale] = useState('en');

  useEffect(() => {
    const controller = new AbortController();
    fetch(SOURCE, { signal: controller.signal })
      .then((res) => (res.ok && res.headers.get('content-type')?.startsWith('text/plain') ? res.text() : ''))
      .then(setRaw)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const sync = () => setLocale(currentLocale());
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
    return () => observer.disconnect();
  }, []);

  const text = pick(raw, locale);
  const root = useRef<HTMLDivElement>(null);
  const item = useRef<HTMLSpanElement>(null);
  const [scroll, setScroll] = useState(false);
  const [duration, setDuration] = useState(20);

  useEffect(() => {
    const el = root.current;
    const first = item.current;
    if (!el || !first) return;
    const measure = () => {
      const natural = first.offsetWidth - (el.dataset.scroll === 'true' ? GAP : 0);
      const available = el.clientWidth - 32;
      setScroll(natural > available);
      setDuration(Math.max(8, (natural + GAP) / SPEED));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [text]);

  if (!text) return null;
  return (
    <>
      <style>{CSS}</style>
      <div
        ref={root}
        className="tb-announcement"
        role="status"
        data-scroll={scroll}
        style={{ '--tb-announce-duration': `${duration}s` } as React.CSSProperties}
      >
        <span className="tb-announcement-track">
          <span className="tb-announcement-item" ref={item}>{text}</span>
          {scroll && <span className="tb-announcement-item" aria-hidden="true">{text}</span>}
        </span>
      </div>
    </>
  );
}
