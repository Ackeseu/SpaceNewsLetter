import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import Article from '../models/Article';
import NewsSource from '../models/NewsSource';
import { buildArticleSummary, trimTextForEmail } from '../utils/articleSummary';

const TITLE_HASH_STOP_WORDS = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'of', 'for', 'and', 'or', 'but',
  'is', 'are', 'was', 'were', 'be', 'been', 'its', 'it', 'this', 'that', 'with',
  'from', 'by', 'as', 'into', 'up', 'out', 'off', 'new', 's', 'has', 'have',
  'will', 'over', 'about', 'after', 'amid', 'says', 'said', 'after'
]);

export const computeTitleHash = (title: string): string => {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !TITLE_HASH_STOP_WORDS.has(w));
  const normalized = words.sort().join(' ');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
};

interface RSSFeed {
  url: string;
  source: string;
  category: string[];
  region?: string;
  requiredKeywords?: string[];
}

const parseBooleanEnv = (value?: string): boolean => {
  if (!value) {
    return false;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

const STRICT_SOURCE_MODE = parseBooleanEnv(process.env.STRICT_SOURCE_MODE);

const GOOGLE_NEWS_QUERY_NEWSPACE_TERMS = [
  'newspace',
  'space startup',
  'space economy',
  'commercial space',
  'satellite',
  'aerospace',
  'low-altitude economy',
  'orbit',
  'launch'
];

const isGoogleNewsAggregatorFeed = (feed: Pick<RSSFeed, 'url' | 'source'>): boolean => {
  const source = feed.source.toLowerCase();
  const url = feed.url.toLowerCase();

  return source.includes('google news') || url.includes('news.google.com/rss/search');
};

const isCurrentYearGoogleNewsItem = (feed: Pick<RSSFeed, 'url' | 'source'>, pubDate?: string): boolean => {
  if (!isGoogleNewsAggregatorFeed(feed)) {
    return true;
  }

  if (!pubDate) {
    return false;
  }

  const parsed = new Date(pubDate);
  if (Number.isNaN(parsed.getTime())) {
    return false;
  }

  return parsed.getFullYear() === new Date().getFullYear();
};

const isCuratedGooglePublisherFeed = (feed: Pick<RSSFeed, 'url' | 'source'>): boolean => {
  if (!isGoogleNewsAggregatorFeed(feed)) {
    return false;
  }

  try {
    const parsed = new URL(feed.url);
    const query = decodeURIComponent((parsed.searchParams.get('q') || '').toLowerCase());
    const hasSiteFilter = query.includes('site:');
    const hasNewSpaceTerm = GOOGLE_NEWS_QUERY_NEWSPACE_TERMS.some((term) => query.includes(term));

    return hasSiteFilter && hasNewSpaceTerm;
  } catch {
    return false;
  }
};

const isStrictAllowedSource = (feed: Pick<RSSFeed, 'url' | 'source'>): boolean => {
  if (isGoogleNewsAggregatorFeed(feed)) {
    return isCuratedGooglePublisherFeed(feed);
  }

  return true;
};

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
    url: 'http://rthk9.rthk.hk/rthk/news/rss/e_expressnews.xml',
    source: 'RTHK Express News',
    category: ['space', 'hong-kong', 'news'],
    region: 'hong-kong',
    requiredKeywords: ['space', 'satellite', 'aerospace', 'rocket', 'orbit', 'newspace', 'low-altitude economy']
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
    category: ['space', 'asia', 'business', 'news', 'hong-kong'],
    region: 'asia'
  },
  {
    url: 'https://news.google.com/rss/search?q=newspace+hong+kong&hl=en-HK&gl=HK&ceid=HK:en',
    source: 'Google News - NewSpace Hong Kong',
    category: ['space', 'newspace', 'hong-kong', 'business'],
    region: 'hong-kong',
    requiredKeywords: ['newspace', 'space startup', 'space economy', 'commercial space', 'satellite', 'aerospace']
  },
  {
    url: 'https://news.google.com/rss/search?q=%22hong+kong%22+satellite&hl=en-HK&gl=HK&ceid=HK:en',
    source: 'Google News - Hong Kong Satellite',
    category: ['space', 'satellite', 'hong-kong', 'business'],
    region: 'hong-kong',
    requiredKeywords: ['satellite', 'space', 'orbit', 'aerospace', 'payload', 'launch']
  },
  {
    url: 'https://news.google.com/rss/search?q=%22low+altitude+economy%22+hong+kong&hl=en-HK&gl=HK&ceid=HK:en',
    source: 'Google News - HK Low Altitude Economy',
    category: ['space', 'newspace', 'hong-kong', 'business', 'low-altitude-economy'],
    region: 'hong-kong',
    requiredKeywords: ['low-altitude economy', 'drone', 'uav', 'uas', 'aerospace', 'airspace']
  },
  {
    url: 'https://news.google.com/rss/search?q=(newspace+OR+%22space+economy%22+OR+satellite+OR+aerospace)+site%3Ascmp.com+%22hong+kong%22&hl=en-HK&gl=HK&ceid=HK:en',
    source: 'Google News - SCMP HK NewSpace',
    category: ['space', 'newspace', 'hong-kong', 'business', 'publisher'],
    region: 'hong-kong',
    requiredKeywords: ['newspace', 'space economy', 'satellite', 'aerospace', 'space startup', 'orbit', 'launch']
  },
  {
    url: 'https://news.google.com/rss/search?q=(newspace+OR+%22space+economy%22+OR+satellite+OR+aerospace)+site%3Athestandard.com.hk+%22hong+kong%22&hl=en-HK&gl=HK&ceid=HK:en',
    source: 'Google News - The Standard HK NewSpace',
    category: ['space', 'newspace', 'hong-kong', 'business', 'publisher'],
    region: 'hong-kong',
    requiredKeywords: ['newspace', 'space economy', 'satellite', 'aerospace', 'space startup', 'orbit', 'launch']
  },
  {
    url: 'https://news.google.com/rss/search?q=(newspace+OR+%22space+economy%22+OR+satellite+OR+aerospace)+site%3Arthk.hk+%22hong+kong%22&hl=en-HK&gl=HK&ceid=HK:en',
    source: 'Google News - RTHK HK NewSpace',
    category: ['space', 'newspace', 'hong-kong', 'business', 'publisher'],
    region: 'hong-kong',
    requiredKeywords: ['newspace', 'space economy', 'satellite', 'aerospace', 'space startup', 'orbit', 'launch']
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

const getDefaultRequiredKeywordsForFeed = (feed: Pick<RSSFeed, 'url' | 'source'>): string[] | undefined => {
  const matchingDefault = DEFAULT_RSS_FEEDS.find((defaultFeed) => (
    defaultFeed.url === feed.url || defaultFeed.source === feed.source
  ));

  return matchingDefault?.requiredKeywords;
};

export const seedDefaultSourcesIfEmpty = async (): Promise<void> => {
  const feedsToSeed = STRICT_SOURCE_MODE
    ? DEFAULT_RSS_FEEDS.filter(isStrictAllowedSource)
    : DEFAULT_RSS_FEEDS;

  await NewsSource.bulkCreate(
    feedsToSeed.map((feed) => ({
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
    const mappedFeeds = configuredFeeds.map((feed) => ({
      url: feed.url,
      source: feed.source,
      category: feed.category,
      region: feed.region || undefined,
      requiredKeywords: getDefaultRequiredKeywordsForFeed({
        url: feed.url,
        source: feed.source
      })
    }));

    if (!STRICT_SOURCE_MODE) {
      return mappedFeeds;
    }

    const filteredFeeds = mappedFeeds.filter(isStrictAllowedSource);
    const excludedCount = mappedFeeds.length - filteredFeeds.length;

    if (excludedCount > 0) {
      console.log(`Strict source mode enabled: excluded ${excludedCount} aggregator source(s).`);
    }

    return filteredFeeds;
  }

  if (!STRICT_SOURCE_MODE) {
    return DEFAULT_RSS_FEEDS;
  }

  const strictDefaults = DEFAULT_RSS_FEEDS.filter(isStrictAllowedSource);
  const excludedCount = DEFAULT_RSS_FEEDS.length - strictDefaults.length;

  if (excludedCount > 0) {
    console.log(`Strict source mode enabled: excluded ${excludedCount} default aggregator source(s).`);
  }

  return strictDefaults;
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

const HONG_KONG_LOCATION_KEYWORDS = [
  'hksar', 'hong kong sar', 'cyberport', 'science park', 'hong kong science park',
  'hkust', 'university of hong kong', 'hku', 'polyu', 'cuhk'
];

const NEWSPACE_KEYWORDS = [
  'newspace', 'space startup', 'space economy', 'low-altitude economy',
  'commercial space', 'satellite startup', 'earth observation', 'smallsat',
  'microsatellite', 'space commercialization', 'space venture'
];

const ASIA_KEYWORDS = [
  'asia', 'asian', 'china', 'japan', 'korea', 'singapore', 'india', 'hong kong', 'hongkong'
];

const SPACE_CORE_KEYWORDS = [
  'space', 'satellite', 'orbit', 'orbital', 'rocket', 'launch', 'aerospace',
  'payload', 'constellation', 'earth observation', 'remote sensing', 'navigation'
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

// Known Google News / Google app logo CDN URL prefix — never a real article image.
// All Google News RSS items return this when the article page isn't accessible.
const GOOGLE_NEWS_LOGO_URL_PREFIX = 'https://lh3.googleusercontent.com/';

const isGoogleNewsLogoUrl = (imageUrl: string): boolean =>
  imageUrl.startsWith(GOOGLE_NEWS_LOGO_URL_PREFIX);

const isGeneratedOrNonRenderableImageUrl = (imageUrl?: string): boolean => {
  if (!imageUrl) {
    return true;
  }

  if (!/^https?:\/\//i.test(imageUrl)) {
    return true;
  }

  if (isGoogleNewsLogoUrl(imageUrl)) {
    return true;
  }

  return /image\.pollinations\.ai\/prompt\//i.test(imageUrl)
    || imageUrl.startsWith('local-themed://');
};

const resolveArticleImageUrl = (_title: string, sourceImageUrl?: string): string | undefined => {
  if (sourceImageUrl && /^https?:\/\//i.test(sourceImageUrl)) {
    return sourceImageUrl;
  }

  return undefined;
};

const extractSourceImageUrlFromRssItem = (
  item: any,
  baseUrl?: string
): string | undefined => {
  const candidates: string[] = [];

  if (item?.enclosure?.url) {
    candidates.push(String(item.enclosure.url));
  }

  const mediaContent = item?.mediaContent;
  if (mediaContent?.$?.url) {
    candidates.push(String(mediaContent.$.url));
  }

  const mediaThumbnail = item?.mediaThumbnail;
  if (mediaThumbnail?.$?.url) {
    candidates.push(String(mediaThumbnail.$.url));
  }

  const imageField = item?.image;
  if (typeof imageField === 'string') {
    candidates.push(imageField);
  } else if (imageField?.url) {
    candidates.push(String(imageField.url));
  }

  const htmlFields = [
    item?.content,
    item?.summary,
    item?.['content:encoded']
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0);

  for (const html of htmlFields) {
    try {
      const $ = cheerio.load(html);
      $('img').each((_, imageElement) => {
        const node = $(imageElement);
        const attrs = [
          node.attr('src'),
          node.attr('data-src'),
          node.attr('data-lazy-src'),
          node.attr('srcset'),
          node.attr('data-srcset')
        ];

        for (const attr of attrs) {
          if (attr) {
            candidates.push(attr);
          }
        }
      });
    } catch {
      // ignore malformed HTML fragments
    }
  }

  const resolvedBase = baseUrl || item?.link || undefined;
  for (const candidate of candidates) {
    const resolved = resolveAbsoluteUrl(candidate, resolvedBase);
    if (resolved && !isGeneratedOrNonRenderableImageUrl(resolved)) {
      return resolved;
    }
  }

  return undefined;
};

const isLikelyArticleImageUrl = (imageUrl?: string): boolean => {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return false;
  }

  if (isGeneratedOrNonRenderableImageUrl(imageUrl)) {
    return false;
  }

  const lower = imageUrl.toLowerCase();
  if (
    lower.includes('logo')
    || lower.includes('favicon')
    || lower.includes('sprite')
    || lower.includes('icon')
    || lower.includes('avatar')
  ) {
    return false;
  }

  return true;
};

const fetchArticleDetailImageUrl = async (
  fetchImpl: typeof import('node-fetch').default,
  articleUrl: string
): Promise<string | undefined> => {
  try {
    const response = await fetchImpl(articleUrl);
    if (!response.ok) {
      return undefined;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const metaCandidates = [
      $('meta[property="og:image"]').attr('content'),
      $('meta[property="og:image:url"]').attr('content'),
      $('meta[name="twitter:image"]').attr('content'),
      $('meta[name="twitter:image:src"]').attr('content'),
      $('link[rel="image_src"]').attr('href')
    ];

    for (const candidate of metaCandidates) {
      const resolved = resolveAbsoluteUrl(candidate, articleUrl);
      if (resolved && isLikelyArticleImageUrl(resolved)) {
        return resolved;
      }
    }

    const imageCandidates = $('img').toArray().flatMap((node) => {
      const image = $(node);
      return [
        image.attr('src'),
        image.attr('data-src'),
        image.attr('data-lazy-src'),
        image.attr('srcset'),
        image.attr('data-srcset')
      ];
    });

    for (const candidate of imageCandidates) {
      const resolved = resolveAbsoluteUrl(candidate, articleUrl);
      if (resolved && isLikelyArticleImageUrl(resolved)) {
        return resolved;
      }
    }

    return undefined;
  } catch {
    return undefined;
  }
};

const hasAnyKeyword = (text: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => text.includes(keyword));
};

const passesFeedKeywordGate = (
  title: string,
  description: string,
  feedConfig: RSSFeed
): boolean => {
  const text = `${title} ${description}`.toLowerCase();

  const hasRequiredKeywords = (() => {
    if (!feedConfig.requiredKeywords || feedConfig.requiredKeywords.length === 0) {
      return true;
    }

    const requiredKeywords = feedConfig.requiredKeywords.map((keyword) => keyword.toLowerCase());
    return hasAnyKeyword(text, requiredKeywords);
  })();

  if (!hasRequiredKeywords) {
    return false;
  }

  const isCuratedPublisherSource =
    isGoogleNewsAggregatorFeed(feedConfig)
    && isCuratedGooglePublisherFeed(feedConfig)
    && feedConfig.source.toLowerCase().includes('hk newspace');

  if (!isCuratedPublisherSource) {
    return true;
  }

  const hasNewSpaceIntent = hasAnyKeyword(text, NEWSPACE_KEYWORDS);
  const hasSpaceCoreSignal = hasAnyKeyword(text, SPACE_CORE_KEYWORDS);

  return hasNewSpaceIntent && hasSpaceCoreSignal;
};

const isHongKongFocusedNewSpaceArticle = (
  title: string,
  description: string,
  metadata?: {
    source?: string;
    category?: string[];
    region?: string;
    link?: string;
  }
): boolean => {
  const text = `${title} ${description}`.toLowerCase();
  const source = (metadata?.source || '').toLowerCase();
  const region = (metadata?.region || '').toLowerCase();
  const link = (metadata?.link || '').toLowerCase();
  const category = (metadata?.category || []).map((value) => value.toLowerCase());

  const isOasaEvent =
    source.includes('oasa')
    || category.includes('oasa')
    || (category.includes('events') && link.includes('oasahk.org'))
    || link.includes('oasahk.org/event');

  if (isOasaEvent) {
    return true;
  }

  const hasHongKongSignal =
    hasAnyKeyword(text, HONG_KONG_KEYWORDS)
    || hasAnyKeyword(text, HONG_KONG_LOCATION_KEYWORDS)
    || ['hong-kong', 'hongkong', 'hk'].includes(region)
    || category.some((value) => ['hong-kong', 'hongkong', 'hk'].includes(value))
    || source.includes('hong kong')
    || link.includes('hongkong')
    || link.includes('hong-kong')
    || link.includes('.hk/');

  if (!hasHongKongSignal) {
    return false;
  }

  const hasSpaceSignal =
    hasAnyKeyword(text, SPACE_CORE_KEYWORDS)
    || hasAnyKeyword(text, SPACE_TECH_KEYWORDS)
    || category.some((value) => ['space', 'satellite', 'aerospace', 'technology', 'tech'].includes(value));

  const hasNewSpaceSignal =
    hasAnyKeyword(text, NEWSPACE_KEYWORDS)
    || category.some((value) => ['business', 'startup', 'economy', 'commercial'].includes(value));

  return hasSpaceSignal && hasNewSpaceSignal;
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
  const newSpaceMatches = NEWSPACE_KEYWORDS.filter((keyword) => text.includes(keyword)).length;

  const isBusiness = businessMatches > 0 || category.includes('business');
  const isTechnology = techMatches > 0 || category.includes('technology') || category.includes('tech');
  const isNewSpace = newSpaceMatches > 0 || category.some((value) => ['startup', 'commercial', 'economy'].includes(value));
  const isHongKongRelated =
    ['hong-kong', 'hongkong', 'hk'].includes(region)
    || category.some((value) => ['hong-kong', 'hongkong', 'hk'].includes(value))
    || HONG_KONG_KEYWORDS.some((keyword) => text.includes(keyword))
    || HONG_KONG_LOCATION_KEYWORDS.some((keyword) => text.includes(keyword))
    || source.includes('hong kong')
    || link.includes('hongkong')
    || link.includes('hong-kong')
    || link.includes('.hk/');
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

  if (isHongKongRelated && isNewSpace && isBusiness) {
    return 470 + businessMatches + techMatches + newSpaceMatches;
  }

  if (isHongKongRelated && (isNewSpace || isTechnology)) {
    return 440 + businessMatches + techMatches + newSpaceMatches;
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

const resolveAbsoluteUrl = (rawUrl?: string, baseUrl = OASA_EVENTS_URL): string | undefined => {
  if (!rawUrl) {
    return undefined;
  }

  const normalized = rawUrl.trim();
  if (!normalized || normalized.startsWith('data:')) {
    return undefined;
  }

  const [firstFromSet] = normalized.split(',').map((part) => part.trim()).filter(Boolean);
  const candidate = (firstFromSet || normalized).split(/\s+/)[0];
  if (!candidate) {
    return undefined;
  }

  try {
    return new URL(candidate, baseUrl).toString();
  } catch {
    return undefined;
  }
};

const extractWixWidth = (imageUrl: string): number | undefined => {
  const widthMatch = imageUrl.match(/\/w_(\d+)/i);
  if (!widthMatch) {
    return undefined;
  }

  const parsed = Number(widthMatch[1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }

  return parsed;
};

const isLikelyOasaEventImageUrl = (imageUrl?: string): boolean => {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return false;
  }

  const lower = imageUrl.toLowerCase();
  if (lower.includes('oasa_logo') || lower.includes('/logo') || lower.includes('favicon')) {
    return false;
  }

  const width = extractWixWidth(imageUrl);
  if (typeof width === 'number' && width < 220) {
    return false;
  }

  return true;
};

const isLowQualityOasaImageUrl = (imageUrl?: string): boolean => {
  if (!imageUrl) {
    return true;
  }

  const lower = imageUrl.toLowerCase();
  if (lower.includes('oasa_logo') || lower.includes('/logo') || lower.includes('favicon')) {
    return true;
  }

  const width = extractWixWidth(imageUrl);
  return typeof width === 'number' && width < 220;
};

const extractImageUrlFromElement = (
  $: cheerio.CheerioAPI,
  element: any,
  baseUrl = OASA_EVENTS_URL
): string | undefined => {
  const imageCandidates: string[] = [];
  const selectors = [
    $(element),
    $(element).closest('article, li, section, div'),
    $(element).parent(),
    $(element).parents().slice(0, 5)
  ];

  for (const scope of selectors) {
    const images = [
      ...scope.find('img').toArray(),
      ...scope.prevAll('img').slice(0, 3).toArray(),
      ...scope.nextAll('img').slice(0, 3).toArray()
    ];

    if (images.length === 0) {
      continue;
    }

    const attrs = [
      'src',
      'data-src',
      'data-lazy-src',
      'data-original',
      'data-image',
      'data-wpfc-original-src',
      'srcset',
      'data-srcset'
    ];

    for (const imageNode of images) {
      const imageEl = $(imageNode);
      for (const attr of attrs) {
        const value = imageEl.attr(attr);
        if (value) {
          imageCandidates.push(value);
        }
      }
    }
  }

  for (const candidate of imageCandidates) {
    const resolved = resolveAbsoluteUrl(candidate, baseUrl);
    if (resolved && isLikelyOasaEventImageUrl(resolved)) {
      return resolved;
    }
  }

  return undefined;
};

const fetchEventDetailImageUrl = async (
  fetchImpl: typeof import('node-fetch').default,
  eventUrl: string
): Promise<string | undefined> => {
  try {
    const response = await fetchImpl(eventUrl);
    if (!response.ok) {
      return undefined;
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    const metaCandidates = [
      $('meta[property="og:image"]').attr('content'),
      $('meta[name="twitter:image"]').attr('content'),
      $('meta[property="og:image:url"]').attr('content'),
      $('link[rel="image_src"]').attr('href')
    ];

    for (const candidate of metaCandidates) {
      const resolved = resolveAbsoluteUrl(candidate, eventUrl);
      if (resolved && isLikelyOasaEventImageUrl(resolved)) {
        return resolved;
      }
    }

    const allDetailImages = $('img').toArray()
      .flatMap((img) => {
        const node = $(img);
        return [
          node.attr('src'),
          node.attr('data-src'),
          node.attr('data-lazy-src'),
          node.attr('srcset'),
          node.attr('data-srcset')
        ];
      })
      .map((value) => resolveAbsoluteUrl(value, eventUrl))
      .filter((value): value is string => Boolean(value))
      .filter((value) => isLikelyOasaEventImageUrl(value));

    const ranked = allDetailImages.sort((a, b) => {
      const aw = extractWixWidth(a) || 0;
      const bw = extractWixWidth(b) || 0;
      return bw - aw;
    });

    if (ranked.length > 0) {
      return ranked[0];
    }

    return undefined;
  } catch {
    return undefined;
  }
};

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
      let description = normalizeText(containerText.replace(titleText, '').trim());
      if (description.length < 20) {
        description = 'OASA event details and schedule are available on the event page.';
      }
      description = trimTextForEmail(description, 1200);

      const resolvedImageUrl = extractImageUrlFromElement($, element, OASA_EVENTS_URL);

      eventLinks.set(link, {
        title: titleText,
        description,
        imageUrl: resolvedImageUrl,
        pubDate
      });
    });

    if (eventLinks.size === 0) {
      console.log('No OASA events found on the events page.');
      return 0;
    }

    for (const [link, event] of eventLinks.entries()) {
      const eventImageUrl = event.imageUrl || await fetchEventDetailImageUrl(fetch, link);

      const existingArticle = await Article.findOne({ where: { link } });
      if (existingArticle) {
        const shouldReplaceExistingImage =
          isGeneratedOrNonRenderableImageUrl(existingArticle.imageUrl || undefined)
          || isLowQualityOasaImageUrl(existingArticle.imageUrl || undefined);

        if (eventImageUrl && shouldReplaceExistingImage) {
          existingArticle.imageUrl = eventImageUrl;
          await existingArticle.save();
        }
        continue;
      }

      await Article.create({
        title: event.title,
        description: event.description,
        link,
        pubDate: event.pubDate || new Date(),
        source: OASA_EVENTS_SOURCE,
        category: OASA_EVENTS_CATEGORY,
        imageUrl: resolveArticleImageUrl(event.title, eventImageUrl),
        isFeatured: false,
        priority: calculateArticlePriority(event.title, event.description, {
          source: OASA_EVENTS_SOURCE,
          category: OASA_EVENTS_CATEGORY,
          region: OASA_EVENTS_REGION,
          link
        }),
        region: OASA_EVENTS_REGION,
        titleHash: computeTitleHash(event.title)
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
      let fetchImpl: typeof import('node-fetch').default | null = null;
      let sourceArticleCount = 0;

      for (const item of feed.items) {
        if (sourceArticleCount >= MAX_ARTICLES_PER_SOURCE) break;

        try {
          const title = item.title || 'Untitled';
          const rawDescription = item.contentSnippet || item.content || '';

          if (!passesFeedKeywordGate(title, rawDescription, feedConfig)) {
            continue;
          }

          // HK-focus gate only applies to feeds explicitly targeting Hong Kong content.
          // Global feeds (SpaceNews, NASA, ESA, etc.) supply the "world" newsletter bucket
          // and should not be filtered by HK-signal requirement.
          const isHkTargetedFeed = feedConfig.region === 'hong-kong';
          if (isHkTargetedFeed && !isHongKongFocusedNewSpaceArticle(title, rawDescription, {
            source: feedConfig.source,
            category: feedConfig.category,
            region: feedConfig.region,
            link: item.link || ''
          })) {
            continue;
          }

          if (!isCurrentYearGoogleNewsItem(feedConfig, item.pubDate)) {
            continue;
          }

          // Extract source image URL early so existing records can be upgraded.
          let sourceImageUrl = extractSourceImageUrlFromRssItem(item, item.link || feedConfig.url);
          if (!sourceImageUrl && item.link) {
            if (!fetchImpl) {
              fetchImpl = (await import('node-fetch')).default;
            }

            sourceImageUrl = await fetchArticleDetailImageUrl(fetchImpl, item.link);
          }

          const existingArticle = await Article.findOne({ where: { link: item.link || '' } });
          if (existingArticle) {
            if (
              sourceImageUrl
              && (
                !existingArticle.imageUrl
                || isGeneratedOrNonRenderableImageUrl(existingArticle.imageUrl || undefined)
              )
            ) {
              existingArticle.imageUrl = sourceImageUrl;
              await existingArticle.save();
            }
            continue;
          }

          // Check if article already exists
          const description = buildArticleSummary(title, rawDescription);

          // Calculate priority score
          const priority = calculateArticlePriority(title, rawDescription, {
            source: feedConfig.source,
            category: feedConfig.category,
            region: feedConfig.region,
            link: item.link || ''
          });

          const isTopPriorityArticle = priority >= 500;

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
            region: feedConfig.region,
            titleHash: computeTitleHash(title)
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

export const fetchNewsAPI = async (
  query: string = 'newspace OR "space startup" OR satellite hong kong OR aerospace hong kong'
): Promise<void> => {
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
          if (existingArticle) {
            if (item.urlToImage && isGeneratedOrNonRenderableImageUrl(existingArticle.imageUrl || undefined)) {
              existingArticle.imageUrl = item.urlToImage;
              await existingArticle.save();
            }
            continue;
          }

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
            }),
            titleHash: computeTitleHash(item.title)
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
