#!/usr/bin/env bash
# Check that category_ledger adds up to category_savings_balance on the dev DB.
#
# For every user, every rolling envelope and a spread of dates, the running
# balance of the last ledger row on or before the date has to equal the
# envelope's balance. Read-only: runs in a transaction that is rolled back.
#
#   scripts/dev/check-ledger.sh            # dates from April to next month
#   scripts/dev/check-ledger.sh 2026-01-01 # from another start
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."
# shellcheck source=scripts/dev/lib.sh
source scripts/dev/lib.sh

START="${1:-2026-04-01}"
[[ "$START" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ ]] || die "start must be yyyy-mm-dd"

DEV_PROJECT_NAME=$(detect_dev_project)
assert_is_dev_project "$DEV_PROJECT_NAME"
DB=$(find_container "$DEV_PROJECT_NAME" db)
[ -n "$DB" ] || die "no db container in $DEV_PROJECT_NAME"

docker exec -i "$DB" psql -U postgres -d postgres -q -v ON_ERROR_STOP=1 -At -F' | ' <<SQL
BEGIN;
CREATE TEMP TABLE mismatches (user_id uuid, name text, d date, balance numeric, ledger numeric) ON COMMIT DROP;
DO \$\$
DECLARE u uuid; checks int := 0;
BEGIN
  FOR u IN SELECT DISTINCT user_id FROM public.categories WHERE user_id IS NOT NULL LOOP
    PERFORM set_config('request.jwt.claim.sub', u::text, true);
    PERFORM set_config('request.jwt.claims', json_build_object('sub', u)::text, true);
    INSERT INTO mismatches
    SELECT u, c.name, dt.d, b.bal, l.led
      FROM public.categories c
      CROSS JOIN (SELECT gs::date AS d FROM generate_series('$START'::date, current_date + 40, '6 days') gs
                  UNION SELECT date_trunc('month', current_date)::date
                  UNION SELECT current_date) dt
      CROSS JOIN LATERAL (SELECT COALESCE((SELECT x.cumulative_balance FROM public.category_savings_balance(dt.d) x
                                            WHERE x.category_id = c.id), 0) AS bal) b
      CROSS JOIN LATERAL (SELECT COALESCE((SELECT y.running_balance
                                             FROM (SELECT running_balance, row_number() OVER () rn
                                                     FROM public.category_ledger(c.id, NULL, dt.d)) y
                                            ORDER BY y.rn DESC LIMIT 1), 0) AS led) l
     WHERE c.user_id = u AND c.rolls_over
       AND abs(b.bal - l.led) > 0.005;
    checks := checks + (SELECT count(*) FROM public.categories WHERE user_id = u AND rolls_over)
                     * (SELECT count(*) FROM generate_series('$START'::date, current_date + 40, '6 days'));
  END LOOP;
  RAISE NOTICE 'about % checks', checks;
END \$\$;
SELECT count(*) || ' mismatches' FROM mismatches;
SELECT name, d, balance, ledger FROM mismatches ORDER BY name, d LIMIT 20;
ROLLBACK;
SQL
