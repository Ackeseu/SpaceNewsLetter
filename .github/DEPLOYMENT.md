# GitHub Actions Deployment Setup

This project uses GitHub Actions to automatically deploy to Azure App Service.

## Setup Instructions

### 1. Get Azure Publish Profile

Run this command to download your publish profile:

```bash
az webapp deployment list-publishing-profiles \
  --name newspace-newsletter-api \
  --resource-group newspace-newsletter-rg \
  --xml > publish-profile.xml
```

### 2. Add GitHub Secret

1. Go to your GitHub repository: https://github.com/Ackeseu/SpaceNewsLetter
2. Navigate to **Settings** → **Secrets and variables** → **Actions**
3. Click **New repository secret**
4. Name: `AZURE_WEBAPP_PUBLISH_PROFILE`
5. Value: Paste the entire content of `publish-profile.xml`
6. Click **Add secret**

### 3. Trigger Deployment

The workflow will automatically run when you:
- Push to the `main` branch
- Manually trigger it from the Actions tab

To trigger manually:
1. Go to **Actions** tab in GitHub
2. Select **Deploy to Azure App Service**
3. Click **Run workflow** → **Run workflow**

### 4. Monitor Deployment

- Check the **Actions** tab to see deployment progress
- Build takes ~3-5 minutes
- Once complete, your app will be live at: https://newspace-newsletter-api.azurewebsites.net

## What Gets Deployed

The workflow:
- ✅ Installs dependencies on Linux (Ubuntu)
- ✅ Compiles TypeScript to JavaScript
- ✅ Packages everything (dist/, node_modules/, config files)
- ✅ Deploys to Azure App Service
- ✅ Automatically restarts the app

## Features Included

Your deployed app includes:
- 🇨🇳 **China newspace sources** (Global Times, Xinhua, etc.)
- 🇭🇰 **Hong Kong priority system** (+100 points for HK articles)
- 💼 **Business-focused filtering** (keyword-based scoring)
- 📧 **Azure Communication Services** email integration
- ⏰ **Automated news aggregation** (every 6 hours via Azure Functions)
- 📨 **Weekly newsletters** (Mondays 9 AM UTC)

## Troubleshooting

If deployment fails:
1. Check the Actions tab for error messages
2. Verify the publish profile secret is correct
3. Ensure all environment variables are set in Azure portal

## Next Steps After First Deployment

1. **Test the API**: `curl https://newspace-newsletter-api.azurewebsites.net/health`
2. **Send test email**: 
   ```bash
   curl -X POST https://newspace-newsletter-api.azurewebsites.net/api/newsletters/send-test \
     -H "Content-Type: application/json" \
     -d '{"email": "helios.lam@oasahk.org"}'
   ```
3. **Check articles**: `curl https://newspace-newsletter-api.azurewebsites.net/api/newsletters/articles?limit=5`
