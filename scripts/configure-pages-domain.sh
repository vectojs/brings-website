#!/usr/bin/env bash
# Associate a Pages project with a canonical domain exactly once.
set -euo pipefail

project_name="${1:?Usage: $0 <project_name> <domain_name>}"
domain_name="${2:?Usage: $0 <project_name> <domain_name>}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID is required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN is required}"

if [[ ! "$project_name" =~ ^[a-z0-9-]+$ ]] || [[ ! "$domain_name" =~ ^[a-z0-9.-]+$ ]]; then
  echo "ERROR: invalid Pages project or domain name." >&2
  exit 1
fi

api="https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/pages/projects/${project_name}/domains"
authorization="Authorization: Bearer ${CLOUDFLARE_API_TOKEN}"
status=$(curl --silent --show-error --output /dev/null --write-out "%{http_code}" --header "$authorization" "$api/$domain_name")

if [ "$status" = "200" ]; then
  echo "Cloudflare Pages domain $domain_name is already associated."
  exit 0
fi
if [ "$status" != "404" ]; then
  echo "ERROR: Cloudflare domain lookup returned HTTP $status." >&2
  exit 1
fi

curl --silent --show-error --fail-with-body --output /dev/null --request POST \
  --header "$authorization" --header "Content-Type: application/json" \
  --data "{\"name\":\"${domain_name}\"}" "$api"
echo "Cloudflare Pages domain $domain_name was associated with $project_name."
