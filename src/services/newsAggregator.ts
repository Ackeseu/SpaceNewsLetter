import Parser from 'rss-parser';
import * as cheerio from 'cheerio';
import crypto from 'crypto';
import { Op } from 'sequelize';
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
    url: 'https://spaceflightnow.com/feed/',
    source: 'Spaceflight Now',
    category: ['space', 'launches', 'business']
  },
  // Asia Space News Sources
  {
    url: 'https://news.google.com/rss/search?q=hong+kong+aerospace+OR+satellite+OR+%22space+economy%22&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News - HK Aerospace',
    category: ['space', 'newspace', 'hong-kong', 'business', 'aerospace'],
    region: 'hong-kong',
    requiredKeywords: ['space', 'satellite', 'aerospace', 'rocket', 'orbit', 'newspace', 'space economy', 'commercial space']
  },
  {
    url: 'https://news.google.com/rss/search?q=newspace+hong+kong&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News - NewSpace Hong Kong',
    category: ['space', 'newspace', 'hong-kong', 'business'],
    region: 'hong-kong',
    requiredKeywords: ['newspace', 'space startup', 'space economy', 'commercial space', 'satellite', 'aerospace']
  },
  {
    url: 'https://news.google.com/rss/search?q=%22hong+kong%22+satellite&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News - Hong Kong Satellite',
    category: ['space', 'satellite', 'hong-kong', 'business'],
    region: 'hong-kong',
    requiredKeywords: ['satellite', 'space', 'orbit', 'aerospace', 'payload', 'launch']
  },
  {
    url: 'https://news.google.com/rss/search?q=%22low+altitude+economy%22+hong+kong&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News - HK Low Altitude Economy',
    category: ['space', 'newspace', 'hong-kong', 'business', 'low-altitude-economy'],
    region: 'hong-kong',
    requiredKeywords: ['low-altitude economy', 'drone', 'uav', 'uas', 'aerospace', 'airspace']
  },
  {
    url: 'https://news.google.com/rss/search?q=(newspace+OR+%22space+economy%22+OR+satellite+OR+aerospace)+site%3Ascmp.com+%22hong+kong%22&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News - SCMP HK NewSpace',
    category: ['space', 'newspace', 'hong-kong', 'business', 'publisher'],
    region: 'hong-kong',
    requiredKeywords: ['newspace', 'space economy', 'satellite', 'aerospace', 'space startup', 'orbit', 'launch']
  },
  {
    url: 'https://news.google.com/rss/search?q=(newspace+OR+%22space+economy%22+OR+satellite+OR+aerospace)+site%3Athestandard.com.hk+%22hong+kong%22&hl=en-US&gl=US&ceid=US:en',
    source: 'Google News - The Standard HK NewSpace',
    category: ['space', 'newspace', 'hong-kong', 'business', 'publisher'],
    region: 'hong-kong',
    requiredKeywords: ['newspace', 'space economy', 'satellite', 'aerospace', 'space startup', 'orbit', 'launch']
  },
  {
    url: 'https://news.google.com/rss/search?q=(newspace+OR+%22space+economy%22+OR+satellite+OR+aerospace)+site%3Arthk.hk+%22hong+kong%22&hl=en-US&gl=US&ceid=US:en',
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
const OASA_EVENTS_GENERIC_TITLES = new Set(['rsvp', 'details', 'more info']);
const OASA_EVENTS_DESCRIPTION_CTA_PATTERN = /(more info|rsvp|secure your spot)/gi;

// ─── InvestHK + OASES (HK Government) News Sources ───────────────────────────

const INVESTHK_NEWS_SOURCE = 'InvestHK';
const INVESTHK_NEWS_URL = 'https://www.investhk.gov.hk/en/news/';
const INVESTHK_NEWS_CATEGORY = ['space', 'hong-kong', 'china', 'business', 'enterprise'];
const INVESTHK_NEWS_REGION = 'hong-kong';

const OASES_NEWS_SOURCE = 'OASES News';
const OASES_NEWS_URL = 'https://www.oases.gov.hk/en/news.html';
const OASES_NEWS_CATEGORY = ['space', 'hong-kong', 'china', 'business', 'enterprise'];
const OASES_NEWS_REGION = 'hong-kong';

/** Look-back window for HK government site scrapes (90 days) */
const HK_GOV_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Keywords that indicate space / aerospace sector relevance.
 * Used to filter articles from HK government investment sites so that only
 * China space-company news ends up in the newsletter.
 */
const CHINA_SPACE_FILTER_KEYWORDS = [
  'satellite', 'aerospace', 'rocket', 'orbit', 'spacecraft', 'space station',
  'constellation', 'earth observation', 'remote sensing', 'launch vehicle',
  'launch service', 'low-altitude economy', 'drone', 'uav', 'uas', 'airspace',
  'space technology', 'space economy', 'newspace', 'commercial space',
  'space company', 'space enterprise', 'space industry', 'space startup',
  'space sector', 'space exploration', 'navigation satellite', 'beidou',
  'microsatellite', 'smallsat', 'cubesat', 'propulsion', 'avionics', 'spacetech',
  'space tech', 'space fund', 'space investment'
];

const isChinaSpaceRelatedText = (title: string, extra?: string): boolean => {
  const text = `${title} ${extra || ''}`.toLowerCase();
  return CHINA_SPACE_FILTER_KEYWORDS.some((kw) => text.includes(kw));
};

/**
 * Parse a HK government date embedded in text.
 * Handles: "(9.3.2026)" in titles AND "01.04.2026" standalone text.
 */
const parseEmbeddedHKDate = (text: string): Date | undefined => {
  // Format: (D.M.YYYY) – embedded in OASES title text
  const embeddedMatch = text.match(/\((\d{1,2})\.(\d{1,2})\.(\d{4})\)/);
  if (embeddedMatch) {
    const d = new Date(
      parseInt(embeddedMatch[3], 10),
      parseInt(embeddedMatch[2], 10) - 1,
      parseInt(embeddedMatch[1], 10)
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  // Format: DD.MM.YYYY – standalone date field on InvestHK
  const standaloneMatch = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (standaloneMatch) {
    const d = new Date(
      parseInt(standaloneMatch[3], 10),
      parseInt(standaloneMatch[2], 10) - 1,
      parseInt(standaloneMatch[1], 10)
    );
    if (!Number.isNaN(d.getTime())) return d;
  }

  return undefined;
};

/** Strip "(with photos) (9.3.2026)" suffixes that OASES appends to article titles */
const stripOasesDateSuffix = (title: string): string =>
  title
    .replace(/\s*\(with\s+(?:photos?|videos?|photo\/video)[^)]*\)\s*$/, '')
    .replace(/\s*\(\d{1,2}\.\d{1,2}\.\d{4}\)\s*$/, '')
    .trim();

const saveHKGovArticle = async (
  title: string,
  description: string,
  link: string,
  pubDate: Date,
  source: string,
  category: string[],
  region: string
): Promise<boolean> => {
  try {
    const existing = await Article.findOne({ where: { link } });
    if (existing) return false;

    await Article.create({
      title: normalizeText(title),
      description: buildArticleSummary(title, description),
      link,
      pubDate,
      source,
      category,
      imageUrl: undefined,
      isFeatured: false,
      priority: calculateArticlePriority(title, description, { source, category, region, link }),
      region,
      titleHash: computeTitleHash(title)
    });
    return true;
  } catch (error) {
    console.error(`Error saving HK gov article (${source}):`, error);
    return false;
  }
};

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

const CRIME_WAR_EXCLUSION_KEYWORDS: string[] = [
  'murder', 'homicide', 'robbery', 'theft', 'burglary', 'assault', 'kidnap',
  'trafficking', 'drug bust', 'gang', 'cartel', 'criminal', 'crime',
  'war crime', 'genocide', 'atrocity', 'massacre', 'bombing', 'terrorist',
  'terrorism', 'insurgent', 'insurgency', 'militia', 'war zone', 'warzone',
  'battlefield', 'ceasefire', 'airstrike', 'air strike', 'shelling',
  'casualt', 'fatalities', 'civilian deaths', 'war in', 'military conflict',
  'armed conflict', 'hostage', 'ransom', 'smuggling', 'fraud conviction',
  'indicted', 'arrested for', 'sentenced to'
];

const passesCrimeWarFilter = (text: string): boolean => {
  return !hasAnyKeyword(text, CRIME_WAR_EXCLUSION_KEYWORDS);
};

const passesFeedKeywordGate = (
  title: string,
  description: string,
  feedConfig: RSSFeed
): boolean => {
  const text = `${title} ${description}`.toLowerCase();

  if (!passesCrimeWarFilter(text)) {
    return false;
  }

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

const stripOasaDescriptionCtas = (value: string): string => normalizeText(
  value.replace(OASA_EVENTS_DESCRIPTION_CTA_PATTERN, ' ')
);

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

const HONG_KONG_TIME_ZONE = 'Asia/Hong_Kong';

const getDateKeyInTimeZone = (value: Date | string | number, timeZone: string = HONG_KONG_TIME_ZONE): string => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const year = parts.find((part) => part.type === 'year')?.value || '';
  const month = parts.find((part) => part.type === 'month')?.value || '';
  const day = parts.find((part) => part.type === 'day')?.value || '';

  if (!year || !month || !day) {
    return '';
  }

  return `${year}-${month}-${day}`;
};

const isCurrentOrUpcomingOasaEvent = (pubDate?: Date): boolean => {
  if (!pubDate) {
    return true;
  }

  const eventDateKey = getDateKeyInTimeZone(pubDate);
  const todayDateKey = getDateKeyInTimeZone(new Date());
  if (!eventDateKey || !todayDateKey) {
    return false;
  }

  return eventDateKey >= todayDateKey;
};

const isGenericOasaTitle = (title: string): boolean => OASA_EVENTS_GENERIC_TITLES.has(title.trim().toLowerCase());

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

    $('li[data-hook="events-card"]').each((_, element) => {
      const card = $(element);
      const titleAnchor = card.find('a[data-hook="title"]').first();
      const href = titleAnchor.attr('href');
      if (!href) {
        return;
      }

      const link = resolveAbsoluteUrl(href, OASA_EVENTS_URL);
      if (!link) {
        return;
      }

      if (eventLinks.has(link)) {
        return;
      }

      const titleText = normalizeText(titleAnchor.text())
        || normalizeText(titleAnchor.attr('aria-label') || '')
        || normalizeText(titleAnchor.attr('title') || '');

      if (!titleText || isGenericOasaTitle(titleText)) {
        return;
      }

      const normalizedTitle = titleText.toLowerCase();
      if (OASA_EVENTS_TITLE_EXCLUSIONS.some((keyword) => normalizedTitle.includes(keyword))) {
        return;
      }

      if (titleText.length < 6) {
        return;
      }

      const containerText = normalizeText(card.text());
      const pubDate = extractEventDate(containerText);
      if (!isCurrentOrUpcomingOasaEvent(pubDate)) {
        return;
      }

      const descriptionContainer = card.find('.PLst2a').first().clone();
      descriptionContainer.find('a, button, [role="button"]').remove();

      let description = stripOasaDescriptionCtas(normalizeText(descriptionContainer.text()));
      if (!description) {
        const cardBody = card.clone();
        cardBody.find('a[data-hook="title"], a, button, [role="button"], img').remove();
        description = stripOasaDescriptionCtas(
          normalizeText(cardBody.text().replace(titleText, '').trim())
        );
      }
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
        let hasUpdates = false;

        if (existingArticle.title !== event.title) {
          existingArticle.title = event.title;
          existingArticle.titleHash = computeTitleHash(event.title);
          hasUpdates = true;
        }

        if (existingArticle.description !== event.description) {
          existingArticle.description = event.description;
          hasUpdates = true;
        }

        const nextPubDate = event.pubDate || existingArticle.pubDate || new Date();
        if (new Date(existingArticle.pubDate).getTime() !== new Date(nextPubDate).getTime()) {
          existingArticle.pubDate = nextPubDate;
          hasUpdates = true;
        }

        const shouldReplaceExistingImage =
          isGeneratedOrNonRenderableImageUrl(existingArticle.imageUrl || undefined)
          || isLowQualityOasaImageUrl(existingArticle.imageUrl || undefined);

        const resolvedImageUrl = resolveArticleImageUrl(event.title, eventImageUrl);
        if (resolvedImageUrl && (shouldReplaceExistingImage || existingArticle.imageUrl !== resolvedImageUrl)) {
          existingArticle.imageUrl = resolvedImageUrl;
          hasUpdates = true;
        }

        const nextPriority = calculateArticlePriority(event.title, event.description, {
          source: OASA_EVENTS_SOURCE,
          category: OASA_EVENTS_CATEGORY,
          region: OASA_EVENTS_REGION,
          link
        });
        if (existingArticle.priority !== nextPriority) {
          existingArticle.priority = nextPriority;
          hasUpdates = true;
        }

        if (hasUpdates) {
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

    const staleThreshold = new Date();
    staleThreshold.setDate(staleThreshold.getDate() - 30);

    const activeLinks = [...eventLinks.keys()];
    const staleWhere: any = {
      source: OASA_EVENTS_SOURCE,
      pubDate: { [Op.gte]: staleThreshold }
    };

    if (activeLinks.length > 0) {
      staleWhere.link = { [Op.notIn]: activeLinks };
    }

    const staleRemoved = await Article.destroy({ where: staleWhere });
    if (staleRemoved > 0) {
      console.log(`Removed ${staleRemoved} stale OASA event article(s) no longer on the live events page.`);
    }
  } catch (error) {
    console.error('Error fetching OASA events:', error);
  }

  return articlesAdded;
};

/**
 * Scrapes https://www.investhk.gov.hk/en/news/ for recent articles
 * about China space-related companies and saves them to the DB.
 */
const fetchInvestHKNews = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - HK_GOV_LOOKBACK_MS);
  let added = 0;

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(INVESTHK_NEWS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)' }
    });

    if (!response.ok) {
      console.error(`InvestHK news fetch failed: ${response.status}`);
      return 0;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const seenLinks = new Set<string>();

    // Collect article entries from anchor tags whose href path is an article slug
    // (filter out navigation items, filter params, and top-level /en/news/ links)
    const articleEntries: Array<{ title: string; link: string; containerText: string }> = [];

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      const isArticleLink =
        href.includes('/en/news/')
        && !href.includes('?')
        && !/\/en\/news\/?$/.test(href);

      if (!isArticleLink) return;

      const fullUrl = href.startsWith('http')
        ? href
        : `https://www.investhk.gov.hk${href}`;

      if (seenLinks.has(fullUrl)) return;
      seenLinks.add(fullUrl);

      const titleText = normalizeText($(el).text());
      if (!titleText || titleText.length < 10) return;

      // Look for the date in the surrounding container (DD.MM.YYYY format)
      const container = $(el).closest('div, article, li, section');
      const containerText = normalizeText(
        container.length ? container.text() : $(el).parent().text()
      );

      articleEntries.push({ title: titleText, link: fullUrl, containerText });
    });

    for (const entry of articleEntries) {
      const pubDate = parseEmbeddedHKDate(entry.containerText);
      if (!pubDate || pubDate < cutoff) continue;

      if (!isChinaSpaceRelatedText(entry.title, entry.containerText)) continue;

      const saved = await saveHKGovArticle(
        entry.title,
        entry.containerText.slice(0, 600),
        entry.link,
        pubDate,
        INVESTHK_NEWS_SOURCE,
        INVESTHK_NEWS_CATEGORY,
        INVESTHK_NEWS_REGION
      );
      if (saved) added++;
    }

    console.log(`✓ InvestHK: added ${added} new China space-related article(s)`);
  } catch (error) {
    console.error('Error fetching InvestHK news:', error);
  }

  return added;
};

/**
 * Scrapes https://www.oases.gov.hk/en/news.html for recent press-release links
 * about China space-related companies and saves them to the DB.
 */
const fetchOasesNewsArticles = async (): Promise<number> => {
  const cutoff = new Date(Date.now() - HK_GOV_LOOKBACK_MS);
  let added = 0;

  try {
    const fetch = (await import('node-fetch')).default;
    const response = await fetch(OASES_NEWS_URL, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NewsAggregator/1.0)' }
    });

    if (!response.ok) {
      console.error(`OASES news fetch failed: ${response.status}`);
      return 0;
    }

    const html = await response.text();
    const $ = cheerio.load(html);
    const seenLinks = new Set<string>();

    // OASES press releases link to info.gov.hk, news.gov.hk, or other external gov URLs.
    // The raw anchor text contains the date embedded as "(D.M.YYYY)" at the end.
    const articleEntries: Array<{ title: string; link: string; pubDate: Date }> = [];

    $('a[href]').each((_, el) => {
      const href = ($(el).attr('href') || '').trim();
      const isArticleLink =
        href.includes('info.gov.hk')
        || href.includes('news.gov.hk')
        || (href.startsWith('https://') && !href.includes('oases.gov.hk'));

      if (!isArticleLink) return;
      if (seenLinks.has(href)) return;
      seenLinks.add(href);

      const rawTitle = normalizeText($(el).text());
      if (!rawTitle || rawTitle.length < 10) return;

      const pubDate = parseEmbeddedHKDate(rawTitle);
      if (!pubDate || pubDate < cutoff) return;

      const cleanTitle = stripOasesDateSuffix(rawTitle);
      if (!cleanTitle || cleanTitle.length < 10) return;

      if (!isChinaSpaceRelatedText(cleanTitle)) return;

      articleEntries.push({ title: cleanTitle, link: href, pubDate });
    });

    for (const entry of articleEntries) {
      const saved = await saveHKGovArticle(
        entry.title,
        `OASES press release: ${entry.title}`,
        entry.link,
        entry.pubDate,
        OASES_NEWS_SOURCE,
        OASES_NEWS_CATEGORY,
        OASES_NEWS_REGION
      );
      if (saved) added++;
    }

    console.log(`✓ OASES News: added ${added} new China space-related article(s)`);
  } catch (error) {
    console.error('Error fetching OASES news articles:', error);
  }

  return added;
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

  // HK government sites: InvestHK + OASES (China space-related company news)
  const investhkAdded = await fetchInvestHKNews();
  const oasesNewsAdded = await fetchOasesNewsArticles();
  articlesAdded += investhkAdded + oasesNewsAdded;

  // Supplement RSS with API-based sources for regions where RSS is blocked on Azure
  const apiArticlesAdded = await fetchApiBasedSources();
  articlesAdded += apiArticlesAdded;

  console.log(`✓ Total new articles added: ${articlesAdded}`);
  return articlesAdded;
};

// Queries used by both NewsAPI and Bing to supplement HK/Asia coverage
const API_SOURCE_QUERIES: Array<{ query: string; region: string; category: string[] }> = [
  {
    query: 'hong kong aerospace OR satellite OR "space economy" OR newspace',
    region: 'hong-kong',
    category: ['space', 'newspace', 'hong-kong', 'business']
  },
  {
    query: '"low altitude economy" hong kong',
    region: 'hong-kong',
    category: ['space', 'newspace', 'hong-kong', 'business', 'low-altitude-economy']
  },
  {
    query: 'newspace OR "commercial space" OR satellite startup asia',
    region: 'asia',
    category: ['space', 'newspace', 'asia', 'business']
  }
];

const saveApiArticle = async (
  title: string,
  description: string,
  link: string,
  publishedAt: string | Date,
  sourceName: string,
  imageUrl: string | undefined,
  region: string,
  category: string[]
): Promise<boolean> => {
  try {
    if (!title || !link || link === '[Removed]' || title === '[Removed]') return false;

    const existingArticle = await Article.findOne({ where: { link } });
    if (existingArticle) {
      if (imageUrl && isGeneratedOrNonRenderableImageUrl(existingArticle.imageUrl || undefined)) {
        existingArticle.imageUrl = imageUrl;
        await existingArticle.save();
      }
      return false;
    }

    const rawDesc = description || '';
    if (!passesFeedKeywordGate(title, rawDesc, { url: link, source: sourceName, category, region })) {
      return false;
    }

    await Article.create({
      title,
      description: buildArticleSummary(title, rawDesc),
      link,
      pubDate: new Date(publishedAt),
      source: sourceName,
      category,
      imageUrl: resolveArticleImageUrl(title, imageUrl),
      isFeatured: false,
      priority: calculateArticlePriority(title, rawDesc, { source: sourceName, category, region, link }),
      region,
      titleHash: computeTitleHash(title)
    });
    return true;
  } catch (error) {
    console.error('Error saving API article:', error);
    return false;
  }
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

const fetchFromNewsAPI = async (): Promise<number> => {
  const apiKey = process.env.NEWS_API_KEY;
  if (!apiKey) return 0;

  console.log('Fetching HK/Asia articles from NewsAPI...');
  let added = 0;

  try {
    const fetch = (await import('node-fetch')).default;

    for (const { query, region, category } of API_SOURCE_QUERIES) {
      const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&language=en&pageSize=20&apiKey=${apiKey}`;
      const response = await fetch(url);
      const data: any = await response.json();

      if (data.status !== 'ok' || !data.articles) {
        console.error(`NewsAPI error for query "${query}": ${data.message || data.status}`);
        continue;
      }

      for (const item of data.articles) {
        const saved = await saveApiArticle(
          item.title,
          item.description || item.content || '',
          item.url,
          item.publishedAt,
          item.source?.name || 'NewsAPI',
          item.urlToImage,
          region,
          category
        );
        if (saved) added++;
      }
    }

    console.log(`✓ NewsAPI: added ${added} new HK/Asia articles`);
  } catch (error) {
    console.error('Error fetching from NewsAPI:', error);
  }

  return added;
};

const fetchFromBingNews = async (): Promise<number> => {
  const apiKey = process.env.BING_NEWS_API_KEY;
  if (!apiKey) return 0;

  console.log('Fetching HK/Asia articles from Bing News...');
  let added = 0;

  try {
    const fetch = (await import('node-fetch')).default;

    for (const { query, region, category } of API_SOURCE_QUERIES) {
      const url = `https://api.bing.microsoft.com/v7.0/news/search?q=${encodeURIComponent(query)}&count=20&mkt=en-US&freshness=Week`;
      const response = await fetch(url, {
        headers: { 'Ocp-Apim-Subscription-Key': apiKey }
      });
      const data: any = await response.json();

      if (!data.value) {
        console.error(`Bing News error for query "${query}": ${JSON.stringify(data)}`);
        continue;
      }

      for (const item of data.value) {
        const imageUrl = item.image?.thumbnail?.contentUrl;
        const saved = await saveApiArticle(
          item.name,
          item.description || '',
          item.url,
          item.datePublished,
          item.provider?.[0]?.name || 'Bing News',
          imageUrl,
          region,
          category
        );
        if (saved) added++;
      }
    }

    console.log(`✓ Bing News: added ${added} new HK/Asia articles`);
  } catch (error) {
    console.error('Error fetching from Bing News:', error);
  }

  return added;
};

// Called by aggregateNews — uses whichever API key is configured (Bing preferred, NewsAPI fallback)
const fetchApiBasedSources = async (): Promise<number> => {
  if (process.env.BING_NEWS_API_KEY) {
    return fetchFromBingNews();
  }
  if (process.env.NEWS_API_KEY) {
    return fetchFromNewsAPI();
  }
  return 0;
};
