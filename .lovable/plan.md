## Dashboard privacy mode

### 1. Add the dashboard control
- Place an accessible eye / crossed-eye icon button beside the dashboard title on mobile and desktop.
- Use clear German and English labels/tooltips for “Hide amounts” and “Show amounts”.
- Keep this control and its state local to the dashboard; no other route is affected.

### 2. Remember the state safely on this device
- Store the dashboard privacy preference in browser-local storage and restore it on future visits.
- Make initial rendering privacy-safe so a previously hidden dashboard does not briefly expose values while the page hydrates.
- Handle unavailable or malformed browser storage without breaking the dashboard.

### 3. Blur aggregate financial information
Apply a reusable privacy-value treatment to dashboard summaries, including:
- Net worth, assets/liabilities totals, foreign-currency breakdowns, projected balances, and individual account balances.
- Monthly budget verdict and all budget summary values.
- Open-IOU section totals, while leaving each underlying IOU amount visible.
- Trend totals and percentages.

The blur will preserve the existing layout and colors, prevent text selection while hidden, and transition cleanly when toggled.

### 4. Keep transaction-level information visible
Do not conceal amounts in:
- Recent transactions.
- Top transactions this month.
- Upcoming recurring entries.
- Pending confirmations.
- Individual open IOU/reimbursement rows and their transaction-specific progress details.

### 5. Validate behavior
- Add focused tests for persisted-state restoration, toggling, and the distinction between aggregate and transaction-level amounts.
- Verify the dashboard at the current mobile viewport and desktop width: no layout shift, control remains reachable, summaries blur, individual transactions remain readable, and the state survives a reload.