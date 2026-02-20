import Parser from 'rss-parser';
import Article from '../models/Article';
import NewsSource from '../models/NewsSource';

interface RSSFeed {
  url: string;
  source: string;
  category: string[];
  region?: string;
}

export const DEFAULT_RSS_FEEDS: RSSFeed[] = [
  // International Space Business News
  {
    url: 'https://spacenews.com/feed/',
    source: 'SpaceNews',
    category: ['space', 'business', 'news']
  },
  {
    url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss',
    source: 'NASA',
    category: ['space', 'nasa']
  },
  {
    url: 'https://www.esa.int/rssfeed/Our_Activities/Space_News',
    source: 'ESA',
    category: ['space', 'esa']
  },
  {
    url: 'https://www.space.com/feeds/all',
    source: 'Space.com',
    category: ['space', 'news']
  },
  {
    url: 'https://spaceflightnow.com/feed/',
    source: 'Spaceflight Now',
    category: ['space', 'launches', 'business']
  },
  // Asia Space News Sources
  {
    url: 'https://www.spacedaily.com/dragonspace.html',
    source: 'Space Daily - Dragon Space (Asia)',
    category: ['space', 'asia', 'business', 'news'],
    region: 'asia'
  },
  // China Space News Sources
  {
    url: 'https://www.globaltimes.cn/rss/outbrain.xml',
    source: 'Global Times (China)',
    category: ['space', 'china', 'business'],
    region: 'china'
  },
  {
    url: 'http://www.xinhuanet.com/english/rss/space.xml',
    source: 'Xinhua Space',
    category: ['space', 'china', 'news'],
    region: 'china'
  },
  // Space Business & Economy Focused
  {
    url: 'https://www.satellitetoday.com/feed/',
    source: 'Satellite Today',
    category: ['space', 'satellite', 'business']
  },
  {
    url: 'https://spacenews.com/section/launch/feed/',
    source: 'SpaceNews Launch',
    category: ['space', 'launch', 'business']
  }
];

export const seedDefaultSourcesIfEmpty = async (): Promise<void> => {
  const sourceCount = await NewsSource.count();
  if (sourceCount > 0) {
    return;
  }

  await NewsSource.bulkCreate(
    DEFAULT_RSS_FEEDS.map((feed) => ({
      url: feed.url,
      source: feed.source,
      category: feed.category,
      region: feed.region,
      isActive: true
    })),
    { ignoreDuplicates: true }
  );
};

const getConfiguredFeeds = async (): Promise<RSSFeed[]> => {
  await seedDefaultSourcesIfEmpty();

  const configuredFeeds = await NewsSource.findAll({
    where: { isActive: true },
    order: [['createdAt', 'ASC']]
  });

  if (configuredFeeds.length > 0) {
    return configuredFeeds.map((feed) => ({
      url: feed.url,
      source: feed.source,
      category: feed.category,
      region: feed.region || undefined
    }));
  }

  return DEFAULT_RSS_FEEDS;
};

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail']
    ]
  }
});

// Keywords indicating business/commercial focus (vs technical/astronomy)
const BUSINESS_KEYWORDS = [
  'market', 'investment', 'funding', 'valuation', 'ipo', 'acquisition',
  'contract', 'deal', 'partnership', 'revenue', 'profit', 'business',
  'commercial', 'industry', 'company', 'startup', 'venture', 'capital',
  'economy', 'trade', 'export', 'manufacturing', 'supply chain', 'customer',
  'satellite operator', 'launch service', 'constellation', 'deployment'
];

// Keywords to deprioritize (technical/astronomy)
const TECHNICAL_KEYWORDS = [
  'galaxy', 'exoplanet', 'nebula', 'quasar', 'telescope observation',
  'cosmic ray', 'dark matter', 'black hole discovery', 'stellar',
  'astrophysics', 'cosmology', 'gravitational wave'
];

// Hong Kong priority keywords
const HONG_KONG_KEYWORDS = [
  'hong kong', 'hongkong', 'hk space', 'hong kong satellite',
  'hong kong aerospace', 'hong kong technology'
];

function calculateArticlePriority(title: string, description: string): number {
  const text = (title + ' ' + description).toLowerCase();
  let priority = 0;

  // Top priority: Hong Kong content (+100)
  if (HONG_KONG_KEYWORDS.some(keyword => text.includes(keyword))) {
    priority += 100;
  }

  // High priority: Business focus (+20)
  const businessMatches = BUSINESS_KEYWORDS.filter(keyword => text.includes(keyword)).length;
  priority += businessMatches * 2;

  // Lower priority: Technical/astronomy content (-10)
  const technicalMatches = TECHNICAL_KEYWORDS.filter(keyword => text.includes(keyword)).length;
  priority -= technicalMatches * 10;

  return priority;
}

export const aggregateNews = async (): Promise<number> => {
  let articlesAdded = 0;
  const MAX_ARTICLES_PER_SOURCE = 5;
  const feeds = await getConfiguredFeeds();

  for (const feedConfig of feeds) {
    try {
      console.log(`Fetching articles from ${feedConfig.source}...`);
      const feed = await parser.parseURL(feedConfig.url);
      let sourceArticleCount = 0;

      for (const item of feed.items) {
        if (sourceArticleCount >= MAX_ARTICLES_PER_SOURCE) break;

        try {
          // Check if article already exists
          const existingArticle = await Article.findOne({ where: { link: item.link || '' } });
          if (existingArticle) continue;

          const title = item.title || 'Untitled';
          const description = item.contentSnippet || item.content || '';

          // Calculate priority score
          const priority = calculateArticlePriority(title, description);

          // Check if article is business-focused or Hong Kong related
          const isBusinessFocused = priority > 0;
          const isHongKongRelated = priority >= 100;

          // Extract image URL
          let imageUrl: string | undefined;
          if (item.enclosure?.url) {
            imageUrl = item.enclosure.url;
          } else if ((item as any).mediaContent) {
            imageUrl = (item as any).mediaContent.$.url;
          } else if ((item as any).mediaThumbnail) {
            imageUrl = (item as any).mediaThumbnail.$.url;
          }

          // Create article with priority
          await Article.create({
            title,
            description,
            link: item.link || '',
            pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
            source: feedConfig.source,
            category: feedConfig.category,
            imageUrl,
            isFeatured: isHongKongRelated, // Auto-feature Hong Kong articles
            priority,
            region: feedConfig.region
          });

          articlesAdded++;
          sourceArticleCount++;

          if (isHongKongRelated) {
            console.log(`  🇭🇰 HIGH PRIORITY: Hong Kong-related article from ${feedConfig.source}`);
          }
        } catch (error) {
          console.error(`Error saving article from ${feedConfig.source}:`, error);
        }
      }

      console.log(`✓ Processed ${sourceArticleCount} new articles from ${feedConfig.source}`);
    } catch (error) {
      console.error(`Error fetching feed from ${feedConfig.source}:`, error);
    }
  }

  console.log(`✓ Total new articles added: ${articlesAdded}`);
  return articlesAdded;
};

export const fetchNewsAPI = async (query: string = 'space exploration'): Promise<void> => {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) {
    console.log('NewsAPI key not configured, skipping...');
    return;
  }

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(
      `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&language=en&apiKey=${apiKey}`
    );

    const data: any = await response.json();

    if (data.articles) {
      for (const item of data.articles) {
        try {
          const existingArticle = await Article.findOne({ where: { link: item.url } });
          if (existingArticle) continue;

          await Article.create({
            title: item.title,
            description: item.description || '',
            link: item.url,
            pubDate: new Date(item.publishedAt),
            source: item.source.name,
            category: ['news'],
            imageUrl: item.urlToImage,
            isFeatured: false
          });
        } catch (error) {
          console.error('Error saving NewsAPI article:', error);
        }
      }
    }

    console.log('✓ NewsAPI articles processed');
  } catch (error) {
    console.error('Error fetching from NewsAPI:', error);
  }
};
