import * as React from "react";
import { de as deLocale } from "date-fns/locale";
import { I18nContext, dicts, localeMap, type I18nCtx, type Lang } from "@/i18n";

export function I18nProvider({
  lang,
  setLang,
  children,
}: {
  lang: Lang;
  setLang: (l: Lang) => void;
  children: React.ReactNode;
}) {
  const t = React.useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      const dict = dicts[lang] ?? dicts.de;
      let s = dict[key] ?? dicts.de[key] ?? key;
      if (vars) for (const k of Object.keys(vars)) s = s.replaceAll(`{${k}}`, String(vars[k]));
      return s;
    },
    [lang],
  );
  const value = React.useMemo<I18nCtx>(
    () => ({ lang, setLang, t, locale: localeMap[lang] ?? deLocale }),
    [lang, setLang, t],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
