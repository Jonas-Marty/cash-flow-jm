import * as React from "react";
import { cn } from "@/lib/utils";

export type SettingsSection = { id: string; label: string };

export function SettingsSectionNav({
  sections,
  title,
}: {
  sections: SettingsSection[];
  title: string;
}) {
  const [active, setActive] = React.useState<string>(sections[0]?.id ?? "");

  React.useEffect(() => {
    const els = sections
      .map((s) => document.getElementById(s.id))
      .filter((el): el is HTMLElement => !!el);
    if (els.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0, 0.1, 1] },
    );
    els.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [sections]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#${id}`);
  };

  return (
    <>
      {/* Mobile: horizontal scroll chips */}
      <nav className="sticky top-14 z-20 -mx-4 mb-4 border-b bg-background/90 px-4 py-2 backdrop-blur lg:hidden">
        <div className="flex gap-2 overflow-x-auto">
          {sections.map((s) => (
            <a
              key={s.id}
              href={`#${s.id}`}
              onClick={(e) => handleClick(e, s.id)}
              className={cn(
                "whitespace-nowrap rounded-full border px-3 py-1 text-xs transition-colors",
                active === s.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {s.label}
            </a>
          ))}
        </div>
      </nav>

      {/* Desktop: sticky vertical list */}
      <aside className="hidden lg:block">
        <div className="sticky top-20">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <ul className="space-y-1 border-l">
            {sections.map((s) => (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  onClick={(e) => handleClick(e, s.id)}
                  className={cn(
                    "-ml-px block border-l-2 py-1 pl-3 text-sm transition-colors",
                    active === s.id
                      ? "border-primary font-medium text-foreground"
                      : "border-transparent text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground",
                  )}
                >
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </>
  );
}