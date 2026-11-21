#!/usr/bin/env bash
set -euo pipefail

api_base=${LUMINOVIA_API_BASE_URL:-}
integration_key=${LUMINOVIA_INTEGRATION_KEY:-}
cursor=${1:-}
https_base='^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?(/backend)?/?$'
loopback_base='^http://127\.0\.0\.1:[0-9]+(/backend)?/?$'
uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

if [[ ! $api_base =~ $https_base && ! $api_base =~ $loopback_base ]]; then
  printf '%s\n' 'Set LUMINOVIA_API_BASE_URL to the API base shown in OpenAPI.' >&2
  exit 2
fi
if [[ ! $integration_key =~ ^lvi_${uuid}_[0-9a-f]{64}$ ]]; then
  printf '%s\n' 'Set LUMINOVIA_INTEGRATION_KEY to a course-index key.' >&2
  exit 2
fi
if (( $# > 1 )) || [[ -n $cursor && ! $cursor =~ ^${uuid}$ ]]; then
  printf '%s\n' 'Pass the previous next_cursor as the only optional argument.' >&2
  exit 2
fi

endpoint="${api_base%/}/functions/v1/company-integration?limit=25"
if [[ -n $cursor ]]; then
  endpoint+="&after=$cursor"
fi

# Read the credential from stdin instead of placing it in the curl arguments.
if ! response=$(printf 'Authorization: Bearer %s\nAccept: application/json\n' "$integration_key" |
  curl --disable --silent --globoff --proto '=https,http' --max-time 15 --header @- \
    --write-out '\n%{http_code}' -- "$endpoint"); then
  printf '%s\n' 'The course index request failed.' >&2
  exit 1
fi
status=${response##*$'\n'}
printf '%s\n' "${response%$'\n'*}"
if [[ $status != 200 ]]; then
  printf 'HTTP %s\n' "$status" >&2
  exit 1
fi
