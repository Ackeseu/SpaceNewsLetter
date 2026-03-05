# Deployment Options (Current)

## Option A (Recommended): GitHub Actions → Azure App Service

Use the existing workflow:

- `.github/workflows/main_newspace-newsletter-api.yml`
- Trigger: push to `main`
- Deploy target: `newspace-newsletter-api`

Pros:
- Reproducible and versioned
- Build/package validation in CI
- Uses OIDC (`azure/login`) with no local deploy dependency

When to use:
- Normal production deployments

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

---

## Delivery Verification Capability

Recipient-level delivery logs are available after deployment:

`GET /api/newsletters/monitor/deliveries?email=<email>&date=YYYY-MM-DD`

Requires header: `x-monitor-token`.
