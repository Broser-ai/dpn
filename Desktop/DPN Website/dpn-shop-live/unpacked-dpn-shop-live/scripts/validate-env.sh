#!/usr/bin/env bash
# validate-env.sh — alias-aware environment validation for DPN runtime readiness.

set -euo pipefail

STRICT="${STRICT:-0}"
if [ "${1:-}" = "--strict" ]; then
  STRICT=1
fi

resolve_first_set() {
  for name in "$@"; do
    value="${!name:-}"
    if [ -z "$value" ]; then
      continue
    fi
    if [ "$value" = '""' ] || [ "$value" = "''" ]; then
      continue
    fi
    printf '%s' "$name"
    return 0
  done
  return 1
}

REQUIRED_GROUPS=(
  "ANTHROPIC_API_KEY"
  "SUPABASE_URL"
  "SUPABASE_SERVICE_KEY SUPABASE_SERVICE_ROLE_KEY"
  "STRIPE_SECRET_KEY"
  "STRIPE_WEBHOOK_SECRET"
  "ADMIN_SECRET_KEY DPN_ADMIN_KEY"
  "FAL_KEY"
)

RECOMMENDED_GROUPS=(
  "POSTMARK_SERVER_TOKEN POSTMARK_TOKEN POSTMARK_API_KEY"
  "POSTMARK_FROM"
  "RESEND_API_KEY"
  "WORDPRESS_URL"
  "WORDPRESS_USER"
  "WORDPRESS_APP_PASSWORD"
)

missing_required=0
missing_recommended=0

printf '=== DPN Environment Validation (bash) ===\n\n'
printf 'Required:\n'
for group in "${REQUIRED_GROUPS[@]}"; do
  IFS=' ' read -r -a names <<< "$group"
  if chosen="$(resolve_first_set "${names[@]}")"; then
    printf '  [OK] %s  (using %s)\n' "$group" "$chosen"
  else
    printf '  [MISSING] %s\n' "$group"
    missing_required=$((missing_required + 1))
  fi
done

printf '\nRecommended:\n'
for group in "${RECOMMENDED_GROUPS[@]}"; do
  IFS=' ' read -r -a names <<< "$group"
  if chosen="$(resolve_first_set "${names[@]}")"; then
    printf '  [OK] %s  (using %s)\n' "$group" "$chosen"
  else
    printf '  [MISSING] %s\n' "$group"
    missing_recommended=$((missing_recommended + 1))
  fi
done

printf '\n'
if [ "$missing_required" -gt 0 ]; then
  printf 'Result: FAIL - missing required groups: %s\n' "$missing_required"
  if [ "$STRICT" = "1" ]; then
    exit 1
  fi
else
  printf 'Result: PASS - all required groups set.\n'
fi

if [ "$missing_recommended" -gt 0 ]; then
  printf 'Note: missing recommended groups: %s\n' "$missing_recommended"
else
  printf 'Note: all recommended groups set.\n'
fi
