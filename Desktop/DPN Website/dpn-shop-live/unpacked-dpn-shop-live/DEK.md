# DPN DEK (Drift Eksekverings Kort)

## Formål

Dette kort gør systemet 100% driftklart efter seneste systemscan.

## Status (nu)

- Kode/import/syntaks: OK
- Cron endpoints (main + unpacked): OK (34/34)
- Env schema dækning: OK (0 mangler i `.env.example`)
- Blokerende punkt: manglende runtime-secrets/tokens i miljø

## Kritiske env-grupper (skal sættes)

1. `SUPABASE_URL`
2. `SUPABASE_SERVICE_KEY` eller `SUPABASE_SERVICE_ROLE_KEY`
3. `STRIPE_SECRET_KEY`
4. `STRIPE_WEBHOOK_SECRET`
5. `ADMIN_SECRET_KEY` eller `DPN_ADMIN_KEY`
6. `FAL_KEY`

## Anbefalede env-grupper (for fuld automation)

1. `POSTMARK_SERVER_TOKEN` eller `POSTMARK_TOKEN` eller `POSTMARK_API_KEY`
2. `POSTMARK_FROM`
3. `RESEND_API_KEY`
4. `WORDPRESS_URL`
5. `WORDPRESS_USER`
6. `WORDPRESS_APP_PASSWORD`

## Validering (Windows)

Kør i projekt-roden:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\validate-env.ps1 -Strict
```

Forventning:

- Exit code `0` = required grupper er sat.
- Exit code `1` = mindst én required gruppe mangler.

## Validering (bash)

```bash
bash ./scripts/validate-env.sh --strict
```

## Live smoke (kræver admin token)

Sæt admin key i terminal (eksempel):

```powershell
$env:ADMIN_SECRET_KEY="<din-nøgle>"
```

Kør derefter smoke på:

1. `/api/harness/poll`
2. `/api/harness/core/director`
3. `/api/harness/autonomous/orchestrator`
4. `/api/harness/autonomous/self-heal`
5. `/api/harness/autonomous/auto-execute`

## Hurtig go/no-go

- GO når:
  - `validate-env.ps1 -Strict` = PASS
  - live smoke = 2xx på alle 5 endpoints
- NO-GO når:
  - required env-grupper mangler
  - 401/5xx på harness smoke
