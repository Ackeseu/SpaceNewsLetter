# NewSpace Newsletter Deployment Runbook

## Current Production Targets

- API App Service: `newspace-newsletter-api`
- Function App: `newspacenewsletter-func`
- Resource Group: `newspace-newsletter-rg`
- Runtime: Node.js 22 LTS

## CI/CD (GitHub Actions)

Workflow file: `.github/workflows/main_newspace-newsletter-api.yml`

Current behavior:
1. Install deps with `npm ci`
2. Build TypeScript with `npm run build`
3. Package and upload the API App Service ZIP (`dist`, `public`, `node_modules`, and package manifests)
4. Install and build `azure-functions/`, then package the Function App ZIP (`dist`, function folders, `host.json`, `node_modules`, and package manifests)
5. Deploy the API ZIP via Azure CLI (`az webapp deployment source config-zip`)
6. Deploy the Functions ZIP via Azure CLI (`az functionapp deployment source config-zip`)

Note: The GitHub OIDC identity used by this workflow must have RBAC access to both apps.
- API app deployment requires access to `newspace-newsletter-api`
- Functions deployment requires access to `newspacenewsletter-func`

If Function App RBAC is missing, the workflow will deploy API and emit a warning that Function deployment was skipped.

## Required App Service Settings

Set in Azure App Service (`newspace-newsletter-api`):

- `NODE_ENV=production`
- `PORT=8080`
- DB settings (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL`)
- Email settings (`AZURE_COMMUNICATION_CONNECTION_STRING`, `SENDER_EMAIL`)
- Production sender: `SENDER_EMAIL=DoNotReply@seahk.org`.
- Keep `SENDER_EMAIL` as a linked raw sender address (no display-name wrapper formatting).
- In Azure Email Communication Services, authenticate `seahk.org` with its verification TXT, SPF, and two DKIM CNAME records, then link the custom domain to the Azure Communication Services resource used by `AZURE_COMMUNICATION_CONNECTION_STRING`. An authenticated but unlinked domain fails sends with `DomainNotLinked`.
- Optional email recovery setting:
  - `EMAIL_FORCE_EXTERNAL_IMAGES=true` (skip inline attachments and send external-image newsletters only when ACS payload limits are still blocking delivery)
- App URL (`APP_URL`)
- Tokens:
  - `ADMIN_TEST_TOKEN`
  - `NEWS_AGGREGATOR_TOKEN`
  - `NEWSLETTER_SENDER_TOKEN`
  - `MONITOR_TOKEN`
  - `MONITOR_ALERT_EMAILS`
  - `MONITOR_MAX_STALE_MINUTES` (recommended `2880` for filtered daily aggregation cadence)
  - `ALLOW_MANUAL_SCHEDULED_SEND` (keep `false` by default; enable temporarily only for an approved manual send)
  - `MANUAL_SEND_CONFIRMATION_TOKEN` (required when configured for manual sends)
- Email payload guard (optional, recommended):
  - `EMAIL_PAYLOAD_SOFT_LIMIT_BYTES` (default `9500000` — sends auto-downgrade through fallback tiers below this byte estimate to stay under the ACS 10 MB hard limit)
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

## Charter Member Operations

Upload the workbook to persistent `/home` storage in the App Service container, not `/home/site/wwwroot`, because ZIP deployments replace the application directory.

Preview and apply the import from **SSH -> Application**:

```bash
cd /home/site/wwwroot
npm run import:charter-members -- "/home/Charter Member Email list .xlsx"
npm run import:charter-members -- "/home/Charter Member Email list .xlsx" --apply
```

The importer skips duplicate email addresses and creates new charter members as verified but inactive. They cannot receive newsletters until explicitly activated. The sender processes recipients sequentially with a default 1.2-second gap plus jitter, retries transient provider failures, and records each delivery attempt.

For an approved charter-only manual send, first use `dryRun=true` with `listName=charter-members` and confirm the recipient count. Then remove `dryRun` and retain the manual authorization headers. Keep `ALLOW_MANUAL_SCHEDULED_SEND` disabled again after the send.

## Notes

- Database schema sync is controlled by `ALTER_DB` (or development mode).
- Recipient-level delivery logging is stored in `newsletter_delivery_logs` and queried via monitor deliveries endpoint.
