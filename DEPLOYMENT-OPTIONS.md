# Deployment Options (Current)

## Option A (Recommended): GitHub Actions → Azure App Service

Use the existing workflow:

- `.github/workflows/main_newspace-newsletter-api.yml`
- Trigger: push to `main`
- Deploy targets: `newspace-newsletter-api` and `newspacenewsletter-func`

Pros:
- Reproducible and versioned
- Build/package validation in CI
- Uses OIDC (`azure/login`) with no local deploy dependency
- Handles both API and Azure Functions packaging/deploy in one run

When to use:
- Normal production deployments

RBAC note:
- The GitHub OIDC identity must have access to both apps.
- If Function App access is missing, API deploy still succeeds and Function deploy is skipped with a warning.

---

## Option B: Manual ZIP Deploy (Recovery / Hotfix)

```bash
cd repo
git archive -o /tmp/newspace-hotfix.zip HEAD
az webapp deployment source config-zip \
  --resource-group newspace-newsletter-rg \
  --name newspace-newsletter-api \
  --src /tmp/newspace-hotfix.zip
```

Pros:
- Fastest path when CI is blocked
- Useful for immediate rollback or recovery

When to use:
- CI outage or urgent restore

---

## Option C: Rollback to Known Good Commit

```bash
cd repo
git archive -o /tmp/newspace-known-good.zip <commit_sha>
az webapp deployment source config-zip \
  --resource-group newspace-newsletter-rg \
  --name newspace-newsletter-api \
  --src /tmp/newspace-known-good.zip
```

Pros:
- Quick, deterministic rollback

When to use:
- Runtime regression after a deployment

---

## Required Runtime Guardrails

1. Startup command must be `npm start`
2. Keep these app settings false for prebuilt package flow:
   - `SCM_DO_BUILD_DURING_DEPLOYMENT=false`
   - `ENABLE_ORYX_BUILD=false`
3. Validate post-deploy:
   - `/health`
   - `/admin.html`
   - `/api/newsletters/monitor/status`
4. Do not store operational workbooks in `/home/site/wwwroot`; ZIP deployments replace that directory. Use persistent `/home` storage for import input.
5. Keep `ALLOW_MANUAL_SCHEDULED_SEND=false` except during an explicitly approved manual campaign.

---

## Delivery Verification Capability

Recipient-level delivery logs are available after deployment:

`GET /api/newsletters/monitor/deliveries?email=<email>&date=YYYY-MM-DD`

Requires header: `x-monitor-token`.

## Capacity Note

The current sender is sequential and intentionally throttled. It is suitable for the current roughly 130-recipient list and modest growth, but each recipient also performs preference/article selection and email image processing. Before reaching roughly 300 recipients, move delivery to resumable background batches and cache rendered content and image attachments by preference group.
