# NewSpace Newsletter

A newsletter subscription service focused on NewSpace (astronomy, space exploration, and low-altitude economy), built with Node.js/Express and designed to run on Microsoft Azure.

## Features

- 📧 Email subscription management with verification
- 🚀 Automated news aggregation from multiple sources (SpaceNews, NASA, ESA)
- 📰 Customizable newsletter frequency (daily, weekly, monthly)
- 🎯 Topic-based preferences
- ☁️ Azure-native architecture
- 🔒 Secure unsubscribe mechanism
- 📱 RESTful API

## Tech Stack

- **Backend**: Node.js + Express + TypeScript
- **Database**: Azure Database for PostgreSQL with Sequelize ORM
- **Email**: Azure Communication Services
- **Scheduling**: Azure Functions (Timer Triggers)
- **News Sources**: RSS feeds (SpaceNews, NASA, ESA) + NewsAPI

## Project Structure

```
├── src/
│   ├── server.ts              # Main server entry point
│   ├── config/
│   │   └── database.ts        # Database configuration
│   ├── models/
│   │   ├── Subscriber.ts      # Subscriber model
│   │   └── Article.ts         # Article model
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

- Node.js 18+ and npm
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

# Optional: AI title image generation (recommended for non-placeholder newsletter images)
AI_IMAGE_PROVIDER=openai
OPENAI_API_KEY=your-openai-api-key
OPENAI_IMAGE_MODEL=gpt-image-1

# Optional: image cache tuning
IMAGE_CACHE_TTL_HOURS=336
IMAGE_CACHE_PLACEHOLDER_TTL_HOURS=6

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
  --name newspace-newsletter \
  --resource-group newspace-newsletter-rg \
  --plan newspace-newsletter-plan \
  --runtime "NODE:18-lts"

# Configure environment variables
az webapp config appsettings set \
  --name newspace-newsletter \
  --resource-group newspace-newsletter-rg \
  --settings @appsettings.json

# Deploy code
az webapp deployment source config-zip \
  --name newspace-newsletter \
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
  --name newspace-newsletter-functions \
  --resource-group newspace-newsletter-rg \
  --consumption-plan-location eastus \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4

# Deploy functions
func azure functionapp publish newspace-newsletter-functions
```

## Testing News Aggregation

To manually trigger news aggregation:

```bash
curl -X POST http://localhost:3000/api/admin/aggregate-news
```

Or run directly:

```bash
npm run dev
# In another terminal
node -e "require('./dist/services/newsAggregator').aggregateNews()"
```

## Monitoring

- **Application Insights**: Automatically integrated with Azure Functions
- **Azure Monitor**: Monitor App Service metrics
- **Logs**: Access via Azure Portal or CLI

```bash
# Stream logs
az webapp log tail --name newspace-newsletter --resource-group newspace-newsletter-rg
```

## Security Best Practices

- ✅ Environment variables for sensitive data
- ✅ SSL/TLS enforcement (Azure PostgreSQL)
- ✅ CORS configuration
- ✅ Helmet.js for security headers
- ✅ Email verification
- ✅ Secure unsubscribe tokens
- ⚠️ TODO: Rate limiting
- ⚠️ TODO: API authentication for admin endpoints

## Next Steps / Enhancements

- [ ] Add admin dashboard
- [ ] Implement rate limiting
- [ ] Add analytics tracking
- [ ] Create email templates library
- [ ] Add A/B testing for newsletters
- [ ] Implement caching (Azure Redis)
- [ ] Add webhook support
- [ ] Create React/Vue frontend
- [ ] Add social media integration
- [ ] Implement recommendation engine

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
