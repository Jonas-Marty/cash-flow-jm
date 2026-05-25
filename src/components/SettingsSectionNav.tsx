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
  const lockUntilRef = React.useRef<number>(0);

  React.useEffect(() => {
    const triggerOffset = 120; // px from top of viewport
    const compute = () => {
      if (performance.now() < lockUntilRef.current) return;
      let current = sections[0]?.id ?? "";
      for (const s of sections) {
        const el = document.getElementById(s.id);
        if (!el) continue;
        const top = el.getBoundingClientRect().top;
        if (top - triggerOffset <= 0) current = s.id;
        else break;
      }
      // If scrolled near bottom of page, force last section active
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
        current = sections[sections.length - 1]?.id ?? current;
      }
      setActive((prev) => (prev === current ? prev : current));
    };
    compute();
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        compute();
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [sections]);

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    e.preventDefault();
    const el = document.getElementById(id);
    if (!el) return;
    setActive(id);
    // Suppress scroll-driven updates while smooth-scrolling settles.
    lockUntilRef.current = performance.now() + 800;
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
      <aside className="hidden lg:col-start-2 lg:row-start-1 lg:block">
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