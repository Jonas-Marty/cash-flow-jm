#!/bin/sh
# Render lds.yaml from the template with the two API keys, then start Envoy.
# Upstream's entrypoint, minus basic auth (no Studio) and the sb_* key
# translation (we use the legacy HS256 keys). `|` as sed delimiter: JWTs have `/`.
set -e
: "${ANON_KEY:?ANON_KEY is required}"
: "${SERVICE_ROLE_KEY:?SERVICE_ROLE_KEY is required}"
sed -e "s|\${ANON_KEY}|${ANON_KEY}|g" \
    -e "s|\${SERVICE_ROLE_KEY}|${SERVICE_ROLE_KEY}|g" \
    /etc/envoy/lds.template.yaml > /etc/envoy/lds.yaml
exec envoy -c /etc/envoy/envoy.yaml "$@"
