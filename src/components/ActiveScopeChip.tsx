import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Target, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { fetchScopes } from "@/lib/finance";
import { useActiveScopeId } from "@/lib/activeScope";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";

export function ActiveScopeChip({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [activeId, setActiveId] = useActiveScopeId();
  const scopesQ = useQuery({ queryKey: ["scopes"], queryFn: fetchScopes });
  const scope = React.useMemo(() => {
    if (!activeId) return null;
    const s = (scopesQ.data ?? []).find((x) => x.id === activeId);
    // If the scope is closed or gone, auto-clear.
    if (!s || s.closed_at) {
      if (activeId) setActiveId(null);
      return null;
    }
    return s;
  }, [activeId, scopesQ.data, setActiveId]);

  if (!scope) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15",
            compact && "px-2 py-0.5",
          )}
          aria-label={t("scopes.chip.aria")}
        >
          <Target className="h-3.5 w-3.5" />
          <span className="max-w-[140px] truncate">{scope.emoji ? "" : ""}{scope.name}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-56 p-2">
        <div className="mb-2 px-1 text-xs text-muted-foreground">{t("scopes.chip.active")}</div>
        <div className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
          <Target className="h-4 w-4 text-primary" />
          <span className="truncate">{scope.name}</span>
        </div>
        <div className="flex flex-col gap-1">
          <Button asChild size="sm" variant="ghost" className="justify-start">
            <Link to="/scopes">{t("scopes.chip.manage")}</Link>
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="justify-start text-destructive hover:text-destructive"
            onClick={() => setActiveId(null)}
          >
            <X className="mr-2 h-4 w-4" />
            {t("scopes.chip.disable")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}