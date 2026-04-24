# Keyboard-friendly Add Transaction

Make the Add Transaction screen fast for power users on a physical keyboard, and tighten the calendar layout on desktop.

## 1. Chip pickers — quick-search instead of long tab chains

Currently Tab cycles through every account and every category chip. With many entities this is slow.

Change `ChipPicker` so that on the Add screen each picker becomes a single Tab stop with built-in type-to-search:

- Render the chip row as a `role="radiogroup"` with `tabIndex={0}` on the group container; only the *selected* chip (or the first chip if none selected) is in the tab order. Arrow keys (←/→ or ↑/↓, plus Home/End) move focus and selection between chips, matching native radio-group semantics. This collapses N tab stops into 1.
- Add a keyboard shortcut to jump straight into the searchable overflow: pressing **/** or **Ctrl/Cmd+K** while focus is in a picker opens the existing `Command` popover with the search input focused. Typing a few letters + Enter selects.
- Also open the same popover when the user starts typing a printable character while a chip is focused (type-ahead → search), so behaviour matches a native `<select>` but with fuzzy match.
- Make the "More" chip itself keyboard-reachable (Enter/Space opens), and ensure the `Command` popover returns focus to the previously focused chip on close.

`EntityChip` keeps its existing tooltip; we add `aria-label={entity.name}` and `aria-pressed`/`aria-checked` so screen readers read the name even when only the icon is visible.

## 2. Calendar — smaller, centered, and date input field (desktop)

- On desktop, constrain `DayHeatmapCalendar` to a fixed max width (around `max-w-sm`, ~360 px) and center it inside its container. Mobile keeps full width.
- Add a small text input next to the date label that accepts the locale's short date format (e.g. `24.04.2026` for de, `04/24/2026` for en). Parse with `date-fns/parse` using a locale-aware format string; on valid parse, update `date` (which is already wired to the calendar). On blur or Enter, normalize the displayed string. Show a subtle inline hint with the expected format.
- Keep the input and the calendar in sync both directions: typing updates the calendar selection and the heatmap navigation month; clicking a day rewrites the input.
- Bonus: support `+`/`-` and `PageUp`/`PageDown` in the input to step by one day / one month respectively.

## 3. Other keyboard wins

- **Global submit**: `Ctrl/Cmd+Enter` triggers Save; `Ctrl/Cmd+Shift+Enter` triggers Save & New. Works from any field.
- **Type switch**: `Alt+1` / `Alt+2` / `Alt+3` switch Expense / Income / Transfer.
- **Suggestion apply**: when suggestions are visible, `Alt+1..9` applies the Nth suggestion (sticky mode); `Alt+0` applies-all on the first suggestion. Already-existing Undo banner stays.
- **Tag append**: in the note field, `Ctrl+#` opens a tiny popover listing the most-used tags and inserts the chosen one.
- **Auto-focus order**: Amount → (suggestions, skipped via roving group) → Account chip group → Category chip group → Payee → Note → Date input → Save buttons. Achieved via the radiogroup change above; no manual `tabIndex` numbers.
- **Discoverability**: add a `?` keyboard-shortcuts cheat sheet (small dialog) opened by pressing `?`, listing all of the above. Translated via i18n.

## 4. Files touched

- `src/components/ChipPicker.tsx` — radiogroup + arrow-key roving focus + `/`, `Ctrl/Cmd+K`, type-ahead, focus-restore.
- `src/components/EntityChip.tsx` — `aria-label`, `aria-checked`, accept `tabIndex` prop, ref forwarding, focus styles.
- `src/components/DayHeatmapCalendar.tsx` — `max-w-sm mx-auto` on `md+`; expose current month for sync.
- `src/components/DateInput.tsx` *(new)* — locale-aware parsed text input with +/- and PageUp/Down stepping.
- `src/components/ShortcutsDialog.tsx` *(new)* — `?` cheat-sheet.
- `src/routes/add.tsx` — wire `DateInput` next to the calendar, register global hotkeys (Ctrl+Enter, Alt+1/2/3, Alt+1..9 for suggestions, `?` to open cheat sheet), center calendar wrapper on desktop.
- `src/i18n/index.tsx` — strings for date format hint, shortcut labels, cheat-sheet entries (DE + EN).
- `architecture.md` — short note in §3.10 / §3.11 about the new keyboard model.

## Out of scope

Server-side keyboard preferences, reordering chips by user-defined hotkey, command-palette across the entire app (only the per-picker search popover is added now).
