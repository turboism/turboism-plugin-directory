"use client";

import { Check, Languages } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLanguage, type Language } from "@/components/language-provider";

const labels: Record<Language, string> = {
  en: "English",
  zh: "简体中文",
  ja: "日本語",
};

const options: Language[] = ["en", "zh", "ja"];

export function LanguageSwitcher() {
  const { language, setLanguage, copy } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  function changeLanguage(next: Language) {
    setLanguage(next);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={copy.selectLanguage}
        className="flex min-h-11 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors hover:bg-slate-100/80"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <Languages aria-hidden="true" className="size-4" />
        <span>{labels[language]}</span>
      </button>
      {open && (
        <div
          className="absolute right-0 z-50 mt-2 min-w-44 overflow-hidden rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl"
          role="listbox"
        >
          {options.map((locale) => (
            <button
              aria-selected={locale === language}
              className={`flex min-h-11 w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm ${
                locale === language
                  ? "font-semibold text-blue-600"
                  : "text-slate-700 hover:bg-slate-100"
              }`}
              key={locale}
              onClick={() => changeLanguage(locale)}
              role="option"
              type="button"
            >
              {labels[locale]}
              {locale === language && <Check aria-hidden="true" className="size-4" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
