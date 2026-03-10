import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import Article from '../models/Article';
import NewsSource from '../models/NewsSource';
import { buildArticleSummary, trimTextForEmail } from '../utils/articleSummary';

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

// Keywords indicating business/commercial focus
const BUSINESS_KEYWORDS = [
  'market', 'investment', 'funding', 'valuation', 'ipo', 'acquisition',
  'contract', 'deal', 'partnership', 'revenue', 'profit', 'business',
  'commercial', 'industry', 'company', 'startup', 'venture', 'capital',
  'economy', 'trade', 'export', 'manufacturing', 'supply chain', 'customer',
  'satellite operator', 'launch service', 'constellation', 'deployment'
];

// Keywords indicating space technology content
const SPACE_TECH_KEYWORDS = [
  'satellite', 'payload', 'launch vehicle', 'rocket engine', 'propulsion',
  'avionics', 'spacecraft', 'orbital', 'navigation', 'remote sensing',
  'communications satellite', 'earth observation', 'space station',
  'guidance system', 'robotics', 'autonomous', 'aerospace technology'
];

const HONG_KONG_KEYWORDS = [
  'hong kong', 'hongkong', 'hk space', 'hong kong satellite',
  'hong kong aerospace', 'hong kong technology'
];

const ASIA_KEYWORDS = [
  'asia', 'asian', 'china', 'japan', 'korea', 'singapore', 'india', 'hong kong', 'hongkong'
];

const OASA_EVENTS_URL = 'https://www.oasahk.org/events';
const OASA_EVENTS_SOURCE = 'OASA Events';
const OASA_EVENTS_CATEGORY = ['space', 'events', 'oasa', 'hong-kong'];
const OASA_EVENTS_REGION = 'hong-kong';
const OASA_EVENTS_TITLE_EXCLUSIONS = [
  'share event on x',
  'share event on facebook',
  'share event',
  'secure your spot'
];

const AI_TITLE_IMAGES_ENABLED = (process.env.AI_TITLE_IMAGES_ENABLED || 'false').toLowerCase() === 'true';

const buildAiTitleImageUrl = (title: string): string => {
  const cleaned = title.replace(/\s+/g, ' ').trim() || 'Space Update';
  const clippedTitle = cleaned.slice(0, 140);
  const prompt = `space news illustration cinematic inspired by: ${clippedTitle}, no text, no logos`;
  const seed = crypto.createHash('sha256').update(cleaned.toLowerCase()).digest('hex').slice(0, 12);
  const encodedPrompt = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=640&height=360&nologo=true&seed=${seed}`;
};

const resolveArticleImageUrl = (title: string, sourceImageUrl?: string): string | undefined => {
  if (sourceImageUrl && /^https?:\/\//i.test(sourceImageUrl)) {
    return sourceImageUrl;
  }

  // Prefer text-only cards when no real source image exists.
  // AI-generated title images are intentionally disabled by default.
  if (!AI_TITLE_IMAGES_ENABLED) {
    return undefined;
  }

  return buildAiTitleImageUrl(title);
};

function calculateArticlePriority(
  title: string,
  description: string,
  metadata?: {
    source?: string;
    category?: string[];
    region?: string;
    link?: string;
  }
): number {
  const text = `${title} ${description}`.toLowerCase();
  const source = (metadata?.source || '').toLowerCase();
  const region = (metadata?.region || '').toLowerCase();
  const link = (metadata?.link || '').toLowerCase();
  const category = (metadata?.category || []).map((value) => value.toLowerCase());

  const businessMatches = BUSINESS_KEYWORDS.filter((keyword) => text.includes(keyword)).length;
  const techMatches = SPACE_TECH_KEYWORDS.filter((keyword) => text.includes(keyword)).length;

  const isBusiness = businessMatches > 0 || category.includes('business');
  const isTechnology = techMatches > 0 || category.includes('technology') || category.includes('tech');
  const isAsiaRelated =
    ['asia', 'china', 'hong-kong', 'hk'].includes(region)
    || category.some((value) => ['asia', 'china', 'hong-kong'].includes(value))
    || ASIA_KEYWORDS.some((keyword) => text.includes(keyword))
    || HONG_KONG_KEYWORDS.some((keyword) => text.includes(keyword));

  const isOasaEvent =
    source.includes('oasa')
    || category.includes('oasa')
    || (category.includes('events') && link.includes('oasahk.org'))
    || link.includes('oasahk.org/event');

  // Requested display priority order:
  // 1) OASA events
  // 2) Asia related space business
  // 3) Global space business
  // 4) Global space technology
  // 5) Remaining space items
  if (isOasaEvent) {
    return 500 + businessMatches + techMatches;
  }

  if (isAsiaRelated && isBusiness) {
    return 400 + businessMatches;
  }

  if (isBusiness) {
    return 300 + businessMatches;
  }

  if (isTechnology) {
    return 200 + techMatches;
  }

  return 100;
}

const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const extractEventDate = (text: string): Date | undefined => {
  const match = text.match(/([A-Z][a-z]{2}\s\d{1,2},\s\d{4})/);
  if (!match) {
    return undefined;
  }

  const parsed = new Date(match[1]);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }

  return parsed;
};

const fetchOasaEvents = async (): Promise<number> => {
  let articlesAdded = 0;

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(OASA_EVENTS_URL);
    if (!response.ok) {
      console.error(`Error fetching OASA events (${response.status}): ${response.statusText}`);
      return 0;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const eventLinks = new Map<string, {
      title: string;
      description: string;
      imageUrl?: string;
      pubDate?: Date;
    }>();

    $('a[href*="/event-details/"]').each((_, element) => {
      const href = $(element).attr('href');
      if (!href) {
        return;
      }

      const link = href.startsWith('http') ? href : `https://www.oasahk.org${href}`;
      if (eventLinks.has(link)) {
        return;
      }

      const titleText = normalizeText($(element).text())
        || normalizeText($(element).attr('aria-label') || '')
        || normalizeText($(element).attr('title') || '');

      if (!titleText) {
        return;
      }

      const normalizedTitle = titleText.toLowerCase();
      if (OASA_EVENTS_TITLE_EXCLUSIONS.some((keyword) => normalizedTitle.includes(keyword))) {
        return;
      }

      if (titleText.length < 6) {
        return;
      }

      const containerText = normalizeText($(element).parent().text());
      const pubDate = extractEventDate(containerText);
      let description = containerText.replace(titleText, '').trim();
      if (description.length < 20) {
        description = 'OASA event details and schedule are available on the event page.';
      }
      description = trimTextForEmail(description, 420);

      const imageUrl = $(element).closest('div').find('img').first().attr('src');

      eventLinks.set(link, {
        title: titleText,
        description,
        imageUrl: imageUrl && imageUrl.startsWith('http') ? imageUrl : undefined,
        pubDate
      });
    });

    if (eventLinks.size === 0) {
      console.log('No OASA events found on the events page.');
      return 0;
    }

    for (const [link, event] of eventLinks.entries()) {
      const existingArticle = await Article.findOne({ where: { link } });
      if (existingArticle) {
        continue;
      }

      await Article.create({
        title: event.title,
        description: event.description,
        link,
        pubDate: event.pubDate || new Date(),
        source: OASA_EVENTS_SOURCE,
        category: OASA_EVENTS_CATEGORY,
        imageUrl: resolveArticleImageUrl(event.title, event.imageUrl),
        isFeatured: false,
        priority: calculateArticlePriority(event.title, event.description, {
          source: OASA_EVENTS_SOURCE,
          category: OASA_EVENTS_CATEGORY,
          region: OASA_EVENTS_REGION,
          link
        }),
        region: OASA_EVENTS_REGION
      });

      articlesAdded++;
    }
  } catch (error) {
    console.error('Error fetching OASA events:', error);
  }

  return articlesAdded;
};

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
          const rawDescription = item.contentSnippet || item.content || '';
          const description = buildArticleSummary(title, rawDescription);

          // Calculate priority score
          const priority = calculateArticlePriority(title, rawDescription, {
            source: feedConfig.source,
            category: feedConfig.category,
            region: feedConfig.region,
            link: item.link || ''
          });

          const isTopPriorityArticle = priority >= 500;

          // Extract image URL
          let sourceImageUrl: string | undefined;
          if (item.enclosure?.url) {
            sourceImageUrl = item.enclosure.url;
          } else if ((item as any).mediaContent) {
            sourceImageUrl = (item as any).mediaContent.$.url;
          } else if ((item as any).mediaThumbnail) {
            sourceImageUrl = (item as any).mediaThumbnail.$.url;
          }

          const imageUrl = resolveArticleImageUrl(title, sourceImageUrl);

          // Create article with priority
          await Article.create({
            title,
            description,
            link: item.link || '',
            pubDate: item.pubDate ? new Date(item.pubDate) : new Date(),
            source: feedConfig.source,
            category: feedConfig.category,
            imageUrl,
            isFeatured: isTopPriorityArticle,
            priority,
            region: feedConfig.region
          });

          articlesAdded++;
          sourceArticleCount++;

          if (priority >= 400) {
            console.log(`  ⭐ HIGH PRIORITY: Ranked article from ${feedConfig.source}`);
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

  const oasaEventsAdded = await fetchOasaEvents();
  if (oasaEventsAdded > 0) {
    console.log(`✓ Processed ${oasaEventsAdded} new articles from ${OASA_EVENTS_SOURCE}`);
  }
  articlesAdded += oasaEventsAdded;

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
            description: buildArticleSummary(item.title, item.description || item.content || ''),
            link: item.url,
            pubDate: new Date(item.publishedAt),
            source: item.source.name,
            category: ['space', 'news'],
            imageUrl: resolveArticleImageUrl(item.title, item.urlToImage),
            isFeatured: false,
            priority: calculateArticlePriority(item.title, item.description || item.content || '', {
              source: item.source.name,
              category: ['space', 'news'],
              link: item.url
            })
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
