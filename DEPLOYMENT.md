# NewSpace Newsletter Deployment Runbook

## Current Production Targets

- API App Service: `newspace-newsletter-api`
- Function App: `newspacenewsletter-func`
- Resource Group: `newspace-newsletter-rg`
- Runtime: Node.js 20 LTS

## CI/CD (GitHub Actions)

Workflow file: `.github/workflows/main_newspace-newsletter-api.yml`

Current behavior:
1. Install deps with `npm ci`
2. Build TypeScript with `npm run build`
3. Prune dev dependencies
4. Package `dist`, `public`, `node_modules`, and package manifests
5. Deploy ZIP via Azure CLI (`az webapp deployment source config-zip`)

## Required App Service Settings

Set in Azure App Service (`newspace-newsletter-api`):

- `NODE_ENV=production`
- `PORT=8080`
- DB settings (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`)
- Email settings (`AZURE_COMMUNICATION_CONNECTION_STRING`, `SENDER_EMAIL`)
- App URL (`APP_URL`)
- Tokens:
  - `ADMIN_TEST_TOKEN`
  - `NEWS_AGGREGATOR_TOKEN`
  - `NEWSLETTER_SENDER_TOKEN`
  - `MONITOR_TOKEN`
  - `MONITOR_ALERT_EMAILS`
  - `MONITOR_MAX_STALE_MINUTES` (recommended `2880` for filtered daily aggregation cadence)
- Image settings (optional):
  - `TITLE_IMAGE_GENERATION_ENABLED`
  - `AI_IMAGE_PROVIDER`
  - `OPENAI_API_KEY`
  - `OPENAI_IMAGE_MODEL`
  - `IMAGE_CACHE_TTL_HOURS`
  - `IMAGE_CACHE_PLACEHOLDER_TTL_HOURS`

## Startup Command (Important)

Set startup to:

```bash
npm start
```

Do **not** use `npm run build && npm start` for the prebuilt package deploy path.

## Manual Recovery Deploy (if CI is blocked)

```bash
cd repo
git archive -o /tmp/newspace-recover.zip HEAD
az webapp deployment source config-zip \
  --resource-group newspace-newsletter-rg \
  --name newspace-newsletter-api \
  --src /tmp/newspace-recover.zip
```

Then verify:

```bash
curl -sS https://newspace-newsletter-api.azurewebsites.net/health
curl -sS -I https://newspace-newsletter-api.azurewebsites.net/admin.html
```

## Monitoring Endpoints

All require `x-monitor-token`.

- `GET /api/newsletters/monitor/status`
- `POST /api/newsletters/monitor/alert`
- `GET /api/newsletters/monitor/deliveries?email=<email>&date=YYYY-MM-DD`

`MONITOR_MAX_STALE_MINUTES` defines the freshness threshold used by `GET /api/newsletters/monitor/status`.
Set to `2880` minutes to avoid false "aggregation down" alerts when aggregation is daily but filtered enough to have occasional 24h+ content gaps.

## Function Endpoints (called by Function App)

- `POST /api/newsletters/aggregate` with `x-aggregator-token`
- `POST /api/newsletters/send-scheduled` with `x-sender-token`

## Operational Checks

- API health: `GET /health`
- Admin UI: `GET /admin.html`
- Monitor status: `GET /api/newsletters/monitor/status`
- Test send (admin token): `POST /api/newsletters/send-test`

## Notes

- Database schema sync is controlled by `ALTER_DB` (or development mode).
- Recipient-level delivery logging is stored in `newsletter_delivery_logs` and queried via monitor deliveries endpoint.
