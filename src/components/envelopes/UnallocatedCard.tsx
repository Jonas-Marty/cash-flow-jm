import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ChevronDown, TriangleAlert } from "lucide-react";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PrivacyValue } from "@/components/DashboardPrivacy";
import { useI18n } from "@/i18n";
import { cn } from "@/lib/utils";
import { fmtMoney, type EnvelopeReconciliation } from "@/lib/finance";

const NO_CATEGORY = "__none__";

/**
 * Money in transit and money no budget holds, with the check that every franc
 * in an account sits somewhere. "Nicht zugeordnet" opens into what it is made
 * of, and can be handed to a budget from here.
 */
export function UnallocatedCard({
  rec,
  symbol,
  onAssign,
}: {
  rec: EnvelopeReconciliation;
  symbol: string;
  /** Opens Umschichten from "Nicht zugeordnet", with this amount when positive. */
  onAssign: (amount: number | null) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = React.useState(false);
  const balanced = Math.abs(Number(rec.residual)) < 0.005;
  const outstanding = Number(rec.outstanding_reimbursements);
  const unallocated = Number(rec.unallocated);
  const showOutstanding = Math.abs(outstanding) > 0.005;
  const showUnallocated = Math.abs(unallocated) > 0.005;
  if (!showOutstanding && !showUnallocated && balanced) return null;

  const parts = (
    [
      [
        "openings",
        Number(rec.unallocated_openings),
        { to: "/settings" as const, label: t("env.recon.part.openings_link") },
      ],
      [
        "uncategorized",
        Number(rec.unallocated_uncategorized),
        { to: "/transactions" as const, label: t("env.recon.part.uncategorized_link") },
      ],
      ["transfers", Number(rec.unallocated_transfers), null],
      ["plan_gap", Number(rec.unallocated_plan_gap), null],
      [
        "unswept",
        Number(rec.unallocated_unswept),
        { to: "/settings" as const, label: t("env.recon.part.unswept_link") },
      ],
      ["assigned", Number(rec.unallocated_assigned), null],
    ] as Array<[string, number, { to: "/settings" | "/transactions"; label: string } | null]>
  ).filter(([, v]) => Math.abs(v) > 0.005);

  return (
    <Card>
      <CardContent className="space-y-1 py-3 text-sm">
        {showOutstanding && (
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">{t("env.recon.outstanding")}</span>
            <PrivacyValue className="tabular-nums">{fmtMoney(outstanding, symbol)}</PrivacyValue>
          </div>
        )}
        {showUnallocated && (
          <>
            <button
              type="button"
              className="-mx-1 flex w-[calc(100%+0.5rem)] items-baseline justify-between gap-3 rounded px-1 text-left hover:bg-muted/50"
              aria-expanded={open}
              title={t("env.recon.details")}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="flex items-center gap-1 text-muted-foreground">
                {t("env.recon.unallocated")}
                <ChevronDown
                  className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")}
                />
              </span>
              <PrivacyValue className="tabular-nums">{fmtMoney(unallocated, symbol)}</PrivacyValue>
            </button>
            {open && (
              <div className="space-y-2 pb-1 pt-1">
                <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 rounded-md bg-muted px-3 py-2 text-xs">
                  {parts.map(([k, v, link]) => (
                    <React.Fragment key={k}>
                      <span className="min-w-0">
                        <span className="block">{t(`env.recon.part.${k}`)}</span>
                        {link && (
                          <Link
                            to={link.to}
                            search={
                              link.to === "/transactions"
                                ? ({ cats: [NO_CATEGORY], types: ["expense", "income"] } as never)
                                : undefined
                            }
                            className="text-primary underline underline-offset-2 hover:decoration-2"
                          >
                            {link.label}
                          </Link>
                        )}
                      </span>
                      <PrivacyValue className="tabular-nums">{fmtMoney(v, symbol)}</PrivacyValue>
                    </React.Fragment>
                  ))}
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs"
                  onClick={() => onAssign(unallocated > 0 ? unallocated : null)}
                >
                  {t("env.recon.assign")}
                </Button>
              </div>
            )}
          </>
        )}
        {/* Every known way for money to leave the books is accounted for, so a
            gap here is a bug: say so plainly, and stay silent while it closes. */}
        {!balanced && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <span>{t("env.recon.gap", { amount: fmtMoney(Number(rec.residual), symbol) })}</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
