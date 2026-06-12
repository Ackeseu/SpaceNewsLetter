# GitHub Actions Deployment Setup

This repository deploys through GitHub Actions using Azure OIDC login (not publish profile authentication).

## Current Workflow

- Workflow file: `.github/workflows/main_newspace-newsletter-api.yml`
- Triggers:
  - Push to `main`
  - Manual run via `workflow_dispatch`
- Deploy targets:
  - API App Service: `newspace-newsletter-api`
  - Function App: `newspacenewsletter-func`

## Required GitHub Secrets

Add these repository secrets under GitHub Settings -> Secrets and variables -> Actions:

- `AZUREAPPSERVICE_CLIENTID_9B4A83214E3141E9A6F1FE30DF899A3B`
- `AZUREAPPSERVICE_TENANTID_DE46BC94503E44DC883D8334622D1D4B`
- `AZUREAPPSERVICE_SUBSCRIPTIONID_5C957B894AEA465D89A2E62B7DAD9C9D`

These are consumed by `azure/login@v2` in the workflow.

## Azure RBAC Requirements for OIDC Identity

The federated identity used by the workflow must have deployment permissions on:

- `newspace-newsletter-api`
- `newspacenewsletter-func`

If Function App access is missing, API deployment still succeeds and the workflow logs a warning that Function deployment was skipped.

## What the Workflow Deploys

Build job:
1. Runs `npm ci` and `npm run build` for API
2. Prunes API devDependencies
3. Packages API release ZIP with `dist`, `public`, `node_modules`, `package.json`, `package-lock.json`, and optional `web.config`
4. Runs `npm ci` and `npm run build` in `azure-functions/`
5. Prunes Function devDependencies
6. Packages Function ZIP with `dist`, function folders, `host.json`, `node_modules`, `package.json`, and `package-lock.json`

Deploy job:
1. Downloads both artifacts
2. Logs into Azure via OIDC
3. Forces App Service zip-deploy mode (`SCM_DO_BUILD_DURING_DEPLOYMENT=false`, `ENABLE_ORYX_BUILD=false`)
4. Deploys API ZIP via `az webapp deployment source config-zip`
5. Deploys Function ZIP via `az functionapp deployment source config-zip` (when RBAC permits)

## Triggering and Monitoring

- Automatic deploy: push commits to `main`
- Manual deploy: GitHub Actions -> Build and deploy Node.js app to Azure Web App - newspace-newsletter-api -> Run workflow
- Track progress and logs in the Actions tab for that workflow run.

## Post-deploy Validation

1. API health:
   - `curl -sS https://newspace-newsletter-api.azurewebsites.net/health`
2. Aggregation trigger:
   - `POST /api/newsletters/aggregate` with `x-aggregator-token`
3. Pipeline monitor:
   - `GET /api/newsletters/monitor/status` with `x-monitor-token`

## Troubleshooting

If deployment fails:
1. Confirm all three OIDC secrets are present and correct
2. Confirm federated credential and RBAC assignments in Azure
3. Check the failed step logs in GitHub Actions for the exact Azure CLI command output
