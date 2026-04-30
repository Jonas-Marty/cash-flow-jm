#!/usr/bin/env bash
# Generate a matching JWT_SECRET + ANON_KEY + SERVICE_ROLE_KEY triple,
# plus the realtime keys. Print to stdout in .env-pasteable form.
#
# Usage:  bash docker/scripts/gen-keys.sh  >> .env
#
# Requires: openssl, python3 (for HS256 signing without extra deps).
set -euo pipefail

JWT_SECRET="$(openssl rand -hex 32)"
REALTIME_ENC_KEY="$(openssl rand -hex 16)"
REALTIME_SECRET_KEY_BASE="$(openssl rand -base64 64 | tr -d '\n')"
POSTGRES_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-32)"
METRICS_TOKEN="$(openssl rand -hex 24)"
DASHBOARD_PASSWORD="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)"

IAT=$(date +%s)
EXP=$(( IAT + 60*60*24*365*5 )) # 5y, plenty for a self-hosted setup

sign_jwt() {
  local role="$1"
  python3 - "$JWT_SECRET" "$role" "$IAT" "$EXP" <<'PY'
import sys, json, base64, hmac, hashlib
secret, role, iat, exp = sys.argv[1], sys.argv[2], int(sys.argv[3]), int(sys.argv[4])
def b64(b):  # base64url, no padding
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()
header  = b64(json.dumps({"alg":"HS256","typ":"JWT"}, separators=(",",":")).encode())
payload = b64(json.dumps({"role":role,"iss":"supabase","iat":iat,"exp":exp}, separators=(",",":")).encode())
sig = b64(hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest())
print(f"{header}.{payload}.{sig}")
PY
}

ANON_KEY="$(sign_jwt anon)"
SERVICE_ROLE_KEY="$(sign_jwt service_role)"

cat <<EOF
# --- generated $(date -u +%FT%TZ) ---
POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
JWT_SECRET=${JWT_SECRET}
ANON_KEY=${ANON_KEY}
SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}
REALTIME_ENC_KEY=${REALTIME_ENC_KEY}
REALTIME_SECRET_KEY_BASE=${REALTIME_SECRET_KEY_BASE}
METRICS_TOKEN=${METRICS_TOKEN}
DASHBOARD_PASSWORD=${DASHBOARD_PASSWORD}
EOF