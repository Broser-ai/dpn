# DPN System Validation Prompt

Brug denne prompt til en hurtig production-readiness validering.

## Formaal
1. Verificer at API-endpoints svarer uden 404.
2. Verificer at dashboard-sider loader uden JS-fejl.
3. Verificer at kritiske miljovariabler er sat.
4. Verificer at cron-ruter i vercel.json matcher eksisterende filer.

## Tjekliste
- API health: `/api/status`, `/api/admin/health`, `/api/harness/poll`, `/api/vision/pipeline`
- B2B flow: `/api/b2b/portal`, `/api/b2b/catalog`, `/api/b2b/pricing`, `/api/b2b/quotes`
- Publish flow: alle routes i `api/publish/`
- Commerce flow: alle feeds i `api/commerce/`
- Dashboards: `/command-center.html`, `/autopilot.html`, `/harness-control.html`

## Output format
- PASS / WARN / FAIL
- Kort forklaring per check
- Prioriterede fixes (P0, P1, P2)
