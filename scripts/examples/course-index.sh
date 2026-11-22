#!/usr/bin/env bash
set -euo pipefail

api_base=${LUMINOVIA_API_BASE_URL:-}
integration_key=${LUMINOVIA_INTEGRATION_KEY:-}
action=${1:-}
https_base='^https://[A-Za-z0-9][A-Za-z0-9.-]*(:[0-9]+)?(/backend)?/?$'
loopback_base='^http://127\.0\.0\.1:[0-9]+(/backend)?/?$'
uuid='[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

if [[ ! $api_base =~ $https_base && ! $api_base =~ $loopback_base ]]; then
  printf '%s\n' 'Set LUMINOVIA_API_BASE_URL to the API base shown in OpenAPI.' >&2
  exit 2
fi
if [[ ! $integration_key =~ ^lvi_${uuid}_[0-9a-f]{64}$ ]]; then
  printf '%s\n' 'Set LUMINOVIA_INTEGRATION_KEY to the key for the requested operation.' >&2
  exit 2
fi
endpoint="${api_base%/}/functions/v1/company-integration"
options=()
case "$action" in
  enrol)
    if (( $# != 3 )) || [[ ! $2 =~ ^${uuid}$ || ! $3 =~ ^LV(-[0-9A-F]{4}){5}$ ]]; then
      printf '%s\n' 'Pass enrol, the course UUID and the participant identifier.' >&2
      exit 2
    fi
    endpoint+="/enrolments"
    printf -v payload '{"course_id":"%s","participant_id":"%s"}' "$2" "$3"
    options=(--header 'Content-Type: application/json' --data-binary "$payload")
    ;;
  report)
    if (( $# != 2 )) || [[ ! $2 =~ ^${uuid}$ ]]; then
      printf '%s\n' 'Pass report and the published course UUID.' >&2
      exit 2
    fi
    endpoint+="/participation?course_id=$2"
    ;;
  *)
    if (( $# > 1 )) || [[ -n $action && ! $action =~ ^${uuid}$ ]]; then
      printf '%s\n' 'Pass the previous next_cursor as the only optional argument.' >&2
      exit 2
    fi
    endpoint+="?limit=25"
    if [[ -n $action ]]; then
      endpoint+="&after=$action"
    fi
    ;;
esac

# Read the credential from stdin instead of placing it in the curl arguments.
if ! response=$(printf 'Authorization: Bearer %s\nAccept: application/json\n' "$integration_key" |
  curl --disable --silent --globoff --proto '=https,http' --max-time 15 --header @- \
    "${options[@]}" --write-out '\n%{http_code}' -- "$endpoint"); then
  printf '%s\n' 'The course integration request failed.' >&2
  exit 1
fi
status=${response##*$'\n'}
printf '%s\n' "${response%$'\n'*}"
if [[ $status != 200 ]]; then
  printf 'HTTP %s\n' "$status" >&2
  exit 1
fi
