import * as React from "react";
import { Check, ChevronsUpDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

export interface MSCOption {
  value: string;
  label: string;
  visual?: React.ReactNode;
  /** Extra string used for searching (e.g. tag without #). */
  keywords?: string;
}

interface Props {
  options: MSCOption[];
  value: string[];
  onChange: (next: string[]) => void;
  placeholder: string; // shown when empty
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
  /** Singular label e.g. "account"; pluralized when many selected */
  selectedLabel?: (n: number) => string;
}

export function MultiSelectCombobox({
  options,
  value,
  onChange,
  placeholder,
  searchPlaceholder = "Search…",
  emptyText = "No results.",
  className,
  selectedLabel,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const selectedSet = new Set(value);

  const labelById = new Map(options.map((o) => [o.value, o.label]));
  const triggerLabel =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? labelById.get(value[0]) ?? placeholder
        : selectedLabel
          ? selectedLabel(value.length)
          : `${value.length} selected`;

  const toggle = (v: string) => {
    if (selectedSet.has(v)) onChange(value.filter((x) => x !== v));
    else onChange([...value, v]);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("h-9 w-full justify-between font-normal", className)}
        >
          <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
            {triggerLabel}
          </span>
          <div className="flex items-center gap-1">
            {value.length > 0 && (
              <X
                className="h-3.5 w-3.5 text-muted-foreground hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onChange([]);
                }}
              />
            )}
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          </div>
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(itemValue, search, keywords) => {
            const hay = (itemValue + " " + (keywords?.join(" ") ?? "")).toLowerCase();
            return hay.includes(search.toLowerCase()) ? 1 : 0;
          }}
        >
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              {options.map((opt) => {
                const isSel = selectedSet.has(opt.value);
                return (
                  <CommandItem
                    key={opt.value}
                    value={opt.label}
                    keywords={opt.keywords ? [opt.keywords, opt.label] : [opt.label]}
                    onSelect={() => toggle(opt.value)}
                    className="gap-2"
                  >
                    <div className="flex h-4 w-4 items-center justify-center">
                      {isSel ? <Check className="h-4 w-4" /> : null}
                    </div>
                    {opt.visual}
                    <span className="truncate">{opt.label}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
