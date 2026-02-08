import Parser from 'rss-parser';
import Article from '../models/Article';

interface RSSFeed {
  url: string;
  source: string;
  category: string[];
}

const RSS_FEEDS: RSSFeed[] = [
  {
    url: 'https://spacenews.com/feed/',
    source: 'SpaceNews',
    category: ['space', 'news']
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
    category: ['space', 'astronomy']
  },
  {
    url: 'https://phys.org/rss-feed/space-news/',
    source: 'Phys.org',
    category: ['space', 'science']
  },
  {
    url: 'https://www.planetary.org/feed',
    source: 'Planetary Society',
    category: ['space', 'exploration']
  },
  {
    url: 'https://spaceflightnow.com/feed/',
    source: 'Spaceflight Now',
    category: ['space', 'launches']
  }
];

const parser = new Parser({
  customFields: {
    item: [
      ['media:content', 'mediaContent'],
      ['media:thumbnail', 'mediaThumbnail']
    ]
  }
});

export const aggregateNews = async (): Promise<number> => {
  let articlesAdded = 0;
  const MAX_ARTICLES_PER_SOURCE = 5;

  for (const feedConfig of RSS_FEEDS) {
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

          // Extract image URL
          let imageUrl: string | undefined;
          if (item.enclosure?.url) {
            imageUrl = item.enclosure.url;
          } else if ((item as any).mediaContent) {
            imageUrl = (item as any).mediaContent.$.url;
          } else if ((item as any).mediaThumbnail) {
            imageUrl = (item as any).mediaThumbnail.$.url;
          }

          // Create article
          await Article.create({
            title: item.title || 'Untitled',
            description: item.contentSnippet || item.content || '',
            link: item.link || '',
            pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
            source: feedConfig.source,
            category: feedConfig.category,
            imageUrl,
            isFeatured: false
          });

          articlesAdded++;
          sourceArticleCount++;
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
