# NewSpace Newsletter

A newsletter subscription service focused on NewSpace (astronomy, space exploration, and low-altitude economy), built with Node.js/Express and designed to run on Microsoft Azure.

## Features

- 📧 Email subscription management with verification
- 🚀 Automated news aggregation from multiple sources (SpaceNews, NASA, ESA)
- 📰 Customizable newsletter frequency (daily or weekly)
- 🎯 Topic-based preferences
- 🔁 Repeat suppression for non-OASA topics after three sends per topic fingerprint
- 📅 OASA event blurbs render without the site countdown label
- ☁️ Azure-native architecture
- 🔒 Secure unsubscribe mechanism
- 📱 RESTful API

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: Azure Database for PostgreSQL with Sequelize ORM
- **Email**: Azure Communication Services
- **Scheduling**: Azure Functions (Timer Triggers)
- **News Sources**: RSS feeds (SpaceNews, NASA, ESA), curated OASA/InvestHK/OASES pages, and NewsAPI

## Project Structure

```
├── src/
│   ├── server.ts              # Main server entry point
│   ├── config/
│   │   └── database.ts        # Database configuration
│   ├── models/
│   │   ├── Subscriber.ts      # Subscriber model
│   │   ├── Article.ts         # Article model
│   │   └── ArticleTopicSendStat.ts # Topic repeat suppression tracking
│   ├── controllers/
│   │   ├── subscriptionController.ts
│   │   └── newsletterController.ts
│   ├── routes/
│   │   ├── subscriptionRoutes.ts
│   │   └── newsletterRoutes.ts
│   └── services/
│       ├── newsAggregator.ts  # RSS feed parsing
│       └── emailService.ts    # Azure Communication Services
├── azure-functions/
│   ├── NewsAggregator/        # Scheduled news aggregation
│   └── SendNewsletter/        # Scheduled newsletter sending
├── package.json
└── tsconfig.json
```

## Prerequisites

- Node.js 22+ and npm
- Azure account with:
  - Azure Database for PostgreSQL
  - Azure Communication Services
  - Azure Functions (optional, for scheduling)
- NewsAPI key (optional, for additional news sources)

## Local Development Setup

### 1. Clone and Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy `.env.example` to `.env` and fill in your Azure credentials:

```bash
cp .env.example .env
```

Required environment variables:

```env
# Server
NODE_ENV=development
PORT=3000

# Azure PostgreSQL
DB_HOST=your-server.postgres.database.azure.com
DB_PORT=5432
DB_NAME=newsletter_db
DB_USER=your-admin@your-server
DB_PASSWORD=your-password
DB_SSL=true

# Azure Communication Services
AZURE_COMMUNICATION_CONNECTION_STRING=endpoint=https://...
SENDER_EMAIL=donotreply@your-domain.com

# Optional: title image generation
# Set false to suspend generated title imagery in newsletters
TITLE_IMAGE_GENERATION_ENABLED=false
AI_IMAGE_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_IMAGE_MODEL=gpt-image-1

# Optional: Hugging Face title image generation
# Use when AI_IMAGE_PROVIDER=huggingface
HUGGINGFACE_API_KEY=your-huggingface-api-key
HUGGINGFACE_IMAGE_MODEL=black-forest-labs/FLUX.1-dev
# Optional override for custom Inference Endpoint
HUGGINGFACE_IMAGE_ENDPOINT=

# Optional: image cache tuning
IMAGE_CACHE_TTL_HOURS=336
IMAGE_CACHE_PLACEHOLDER_TTL_HOURS=6

# Optional: email payload size guard (bytes). Sends auto-downgrade to lower-fidelity
# fallback tiers when the estimated payload exceeds this limit (ACS hard limit: 10 MB).
EMAIL_PAYLOAD_SOFT_LIMIT_BYTES=9500000

# Emergency override: skip inline attachments and force external images only.
# Useful when ACS payload size limits are still being hit under load.
EMAIL_FORCE_EXTERNAL_IMAGES=false

# Admin & monitor tokens
ADMIN_TEST_TOKEN=your-admin-token
NEWS_AGGREGATOR_TOKEN=your-aggregator-token
NEWSLETTER_SENDER_TOKEN=your-sender-token
MONITOR_TOKEN=your-monitor-token
MONITOR_ALERT_EMAILS=ops@example.com,owner@example.com
# Recommended for filtered/daily aggregation cadence (48h freshness window)
MONITOR_MAX_STALE_MINUTES=2880

# Optional: NewsAPI
NEWS_API_KEY=your-newsapi-key
```

### 3. Set Up Azure Resources

#### Azure Database for PostgreSQL

```bash
# Create resource group
az group create --name newspace-newsletter-rg --location eastus

# Create PostgreSQL server
az postgres flexible-server create \
  --resource-group newspace-newsletter-rg \
  --name newspace-newsletter-db \
  --location eastus \
  --admin-user adminuser \
  --admin-password <YourPassword> \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --version 14

# Create database
az postgres flexible-server db create \
  --resource-group newspace-newsletter-rg \
  --server-name newspace-newsletter-db \
  --database-name newsletter_db

# Configure firewall (allow Azure services)
az postgres flexible-server firewall-rule create \
  --resource-group newspace-newsletter-rg \
  --name newspace-newsletter-db \
  --rule-name AllowAzureServices \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0
```

#### Azure Communication Services

```bash
# Create Communication Services resource
az communication create \
  --name newspace-newsletter-acs \
  --resource-group newspace-newsletter-rg \
  --location global \
  --data-location UnitedStates

# Get connection string
az communication list-key \
  --name newspace-newsletter-acs \
  --resource-group newspace-newsletter-rg
```

### 4. Run Development Server

```bash
npm run dev
```

The API will be available at `http://localhost:3000`.

## API Endpoints

### Subscriptions

- `POST /api/subscriptions/subscribe` - Subscribe to newsletter
  ```json
  {
    "email": "user@example.com",
    "firstName": "John",
    "lastName": "Doe",
    "frequency": "weekly",
    "topics": ["space", "nasa"]
  }
  ```

- `GET /api/subscriptions/verify/:token` - Verify email address
- `GET /api/subscriptions/unsubscribe/:token` - Unsubscribe from newsletter
- `PUT /api/subscriptions/preferences/:id` - Update subscription preferences

### Newsletter/Articles

- `GET /api/newsletters/articles` - Get latest articles
  - Query params: `limit`, `offset`, `source`, `category`
- `GET /api/newsletters/articles/featured` - Get featured articles
- `GET /api/newsletters/articles/:id` - Get specific article
- `POST /api/newsletters/send-test` - Send test newsletter (requires `x-admin-token`)
- `POST /api/newsletters/aggregate` - Trigger aggregation (requires `x-aggregator-token`)
- `POST /api/newsletters/send-scheduled` - Trigger scheduled send (requires `x-sender-token`)
- `GET /api/newsletters/sources` - List news sources (requires admin token)
- `POST /api/newsletters/sources` - Create news source (requires admin token)
- `DELETE /api/newsletters/sources/:id` - Delete news source (requires admin token)

Newsletter behavior notes:

- Subscription frequency is normalized to `daily` or `weekly`; `monthly` is no longer accepted by the API or admin UI.
- OASA event items are rendered in a dedicated section, and the email renderer removes the website countdown prefix such as `34 days to the event`.
- Daily and weekly sends suppress non-OASA topics after three deliveries for the same topic fingerprint using `article_topic_send_stats`.

### Monitoring

- `GET /api/newsletters/monitor/status` - Pipeline health/status (requires `x-monitor-token`)
- `POST /api/newsletters/monitor/alert` - Send monitor alert email (requires `x-monitor-token`)
- `GET /api/newsletters/monitor/deliveries?email=<email>&date=YYYY-MM-DD` - Recipient delivery logs (requires `x-monitor-token`)
- `MONITOR_MAX_STALE_MINUTES` controls when aggregation is marked stale in monitor status (recommended: `2880` for filtered daily cadence)

### Health Check

- `GET /health` - Service health status

## Deployment to Azure

### Option 1: Azure App Service

```bash
# Build the application
npm run build

# Create App Service plan
az appservice plan create \
  --name newspace-newsletter-plan \
  --resource-group newspace-newsletter-rg \
  --sku B1 \
  --is-linux

# Create Web App
az webapp create \
  --name newspace-newsletter-api \
  --resource-group newspace-newsletter-rg \
  --plan newspace-newsletter-plan \
  --runtime "NODE:22-lts"

# Configure environment variables
az webapp config appsettings set \
  --name newspace-newsletter-api \
  --resource-group newspace-newsletter-rg \
  --settings @appsettings.json

# Set startup command (prebuilt package runtime)
az webapp config set \
  --name newspace-newsletter-api \
  --resource-group newspace-newsletter-rg \
  --startup-file "npm start"

# Deploy code
az webapp deployment source config-zip \
  --name newspace-newsletter-api \
  --resource-group newspace-newsletter-rg \
  --src deploy.zip
```

### Option 2: Azure Container Instances

```bash
# Build Docker image
docker build -t newspace-newsletter .

# Push to Azure Container Registry
az acr create --resource-group newspace-newsletter-rg \
  --name newspacenewsletter --sku Basic

az acr login --name newspacenewsletter
docker tag newspace-newsletter newspacenewsletter.azurecr.io/newsletter:latest
docker push newspacenewsletter.azurecr.io/newsletter:latest

# Deploy container
az container create \
  --resource-group newspace-newsletter-rg \
  --name newspace-newsletter \
  --image newspacenewsletter.azurecr.io/newsletter:latest \
  --dns-name-label newspace-newsletter \
  --ports 3000
```

### Deploy Azure Functions

```bash
cd azure-functions

# Install Azure Functions Core Tools
npm install -g azure-functions-core-tools@4

# Create Function App
az functionapp create \
  --name newspacenewsletter-func \
  --resource-group newspace-newsletter-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 22 \
  --functions-version 4

# Deploy functions
func azure functionapp publish newspacenewsletter-func
```

For production, prefer GitHub Actions on `main`, which deploys both the API and Function App using Azure OIDC. See `.github/DEPLOYMENT.md` and `.github/workflows/main_newspace-newsletter-api.yml`.

## Testing Aggregation/Sending

Trigger aggregation (token protected):

```bash
curl -X POST http://localhost:3000/api/newsletters/aggregate \
  -H "x-aggregator-token: <NEWS_AGGREGATOR_TOKEN>"
```

Trigger scheduled send (token protected):

```bash
curl -X POST http://localhost:3000/api/newsletters/send-scheduled \
  -H "Content-Type: application/json" \
  -H "x-sender-token: <NEWSLETTER_SENDER_TOKEN>" \
  -d '{"frequency":"daily"}'
```

## Monitoring

- Use `/api/newsletters/monitor/status` and `/api/newsletters/monitor/deliveries` for pipeline and recipient-level checks.
- Use `/api/newsletters/monitor/alert` for token-protected alert emails.
- For App Service runtime logs, use Azure CLI/Portal.

```bash
az webapp log tail --name newspace-newsletter-api --resource-group newspace-newsletter-rg
```

## Security Best Practices

- ✅ Environment variables for sensitive data
- ✅ SSL/TLS enforcement (Azure PostgreSQL)
- ✅ CORS configuration
- ✅ Helmet.js for security headers
- ✅ Email verification
- ✅ Secure unsubscribe tokens
- ✅ Rate limiting (express-rate-limit on subscription and test-send endpoints)
- ⚠️ TODO: API authentication for admin endpoints

## Next Steps / Enhancements

- [ ] Add analytics tracking
- [ ] Improve delivery telemetry dashboards
- [ ] Add webhook support for external integrations
- [ ] Expand recommendation/personalization logic

## Operational Changelog

- **2026-05-07**: Upgraded runtime to Node.js 22 LTS (Node 20 reached EOL 2026-04-30). Updated CI workflow, App Service stack, and TypeScript target (`ES2022`).
- **2026-05-07**: Added automatic email payload size guard (`EMAIL_PAYLOAD_SOFT_LIMIT_BYTES`). Newsletter sends now auto-downgrade through four fallback tiers (full inline → OASA inline only → external images with logo → zero attachments) to stay under the ACS 10 MB hard limit.
- **2026-05-07**: Fixed OASA section images not rendering in external-image fallback tiers. Wix CDN transform URLs (`/v1/fill/…`) are now normalised before being embedded in `<img src>` to avoid 403 responses in email clients.
- **2026-05-13**: Added emergency `EMAIL_FORCE_EXTERNAL_IMAGES` override to skip inline attachments entirely when payload size limits still block delivery. This is the production recovery path used during the ACS 10 MB incident.
- **2026-03-05**: Added recipient-level newsletter delivery logging (`newsletter_delivery_logs`) and monitor query endpoint: `/api/newsletters/monitor/deliveries?email=<email>&date=YYYY-MM-DD`.
- **2026-03-05**: Suspended title-based generated imagery by default via `TITLE_IMAGE_GENERATION_ENABLED=false`.
- **2026-03-05**: Updated Azure App Service runtime guidance to use startup command `npm start` for prebuilt package deployments.
- **2026-03-05**: Refreshed deployment docs and monitoring guidance in `README.md`, `DEPLOYMENT.md`, and `DEPLOYMENT-OPTIONS.md`.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

## License

ISC

## Support

For issues or questions, please open an issue on GitHub.
