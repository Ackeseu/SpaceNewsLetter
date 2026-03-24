import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import Parser from 'rss-parser';
import Article from '../models/Article';
import Subscriber from '../models/Subscriber';
import NewsletterDeliveryLog from '../models/NewsletterDeliveryLog';
import { consumeLastEmailSendError, sendEmail, sendNewsletterEmail } from '../services/emailService';
import { aggregateNews, seedDefaultSourcesIfEmpty } from '../services/newsAggregator';
import { Op, QueryTypes } from 'sequelize';
import crypto from 'crypto';
import NewsSource from '../models/NewsSource';
import adminChangelogConfig from '../config/adminChangelog.json';

const sourceTestParser = new Parser();

const ADMIN_CHANGELOG_FALLBACK_ENTRIES = [
  {
    date: '2026-03-10',
    title: 'Subscriber search, filters, and pagination moved server-side',
    detail: 'Improves performance for larger subscriber lists and keeps filter state queryable.'
  },
  {
    date: '2026-03-10',
    title: 'Source feed test action added',
    detail: 'Sources tab can now validate RSS fetch/parse and show sampled headlines.'
  },
  {
    date: '2026-03-10',
    title: 'Monitoring received freshness and reliability updates',
    detail: 'Includes last-updated ticker and improved bottom-section rendering flow.'
  }
];

const getAdminChangelogEntries = (): Array<{ date: string; title: string; detail: string }> => {
  if (!Array.isArray(adminChangelogConfig)) {
    return ADMIN_CHANGELOG_FALLBACK_ENTRIES;
  }

  const normalized = adminChangelogConfig
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => ({
      date: String((entry as any).date || '').trim(),
      title: String((entry as any).title || '').trim(),
      detail: String((entry as any).detail || '').trim()
    }))
    .filter((entry) => entry.date && entry.title && entry.detail);

  return normalized.length > 0 ? normalized : ADMIN_CHANGELOG_FALLBACK_ENTRIES;
};

const ensurePreferencesToken = async (subscriber: Subscriber): Promise<string> => {
  if (subscriber.preferencesToken) {
    return subscriber.preferencesToken;
  }

  subscriber.preferencesToken = crypto.randomBytes(32).toString('hex');
  await subscriber.save();
  return subscriber.preferencesToken;
};

const normalizeTopicToken = (value: string): string => value.toLowerCase().trim();

const TOPIC_CATEGORY_ALIASES: Record<string, string[]> = {
  general: [],
  'space exploration': ['space'],
  launches: ['launches', 'launch', 'rocket', 'space'],
  astronomy: ['astronomy', 'space'],
  'space economy': ['business', 'economy', 'newspace', 'commercial', 'startup', 'low-altitude-economy', 'space'],
  'satellite news': ['satellite', 'space']
};

const mapTopicsToCategoryFilters = (topics: string[]): string[] => {
  const normalizedTopics = topics.map(normalizeTopicToken).filter(Boolean);

  if (normalizedTopics.length === 0 || normalizedTopics.includes('general')) {
    return [];
  }

  const mapped = new Set<string>();
  for (const topic of normalizedTopics) {
    const aliases = TOPIC_CATEGORY_ALIASES[topic];
    if (aliases && aliases.length > 0) {
      aliases.forEach((alias) => mapped.add(alias));
      continue;
    }

    mapped.add(topic);
  }

  return Array.from(mapped);
};

const buildPreferenceWhere = (subscriber: Subscriber): Record<string, unknown> => {
  const whereClause: Record<string, unknown> = {};
  const regions = subscriber.regions || [];
  const topics = subscriber.topics || [];

  if (regions.length > 0 && !regions.includes('global')) {
    whereClause.region = { [Op.in]: regions };
  }

  const mappedTopicCategories = mapTopicsToCategoryFilters(topics);
  if (mappedTopicCategories.length > 0) {
    whereClause.category = { [Op.overlap]: mappedTopicCategories };
  }

  return whereClause;
};

const OASA_EVENTS_SOURCE = 'OASA Events';
const DEFAULT_MAX_PER_SOURCE = 2;
const MAX_PER_SOURCE_OVERRIDES: Record<string, number> = {
  [OASA_EVENTS_SOURCE]: 4
};

const getMaxPerSource = (source: string): number => {
  return MAX_PER_SOURCE_OVERRIDES[source] ?? DEFAULT_MAX_PER_SOURCE;
};

type SessionBucket = 'oasa' | 'hong-kong' | 'china' | 'world';

const NEWSLETTER_SESSION_PLAN: Array<{ bucket: SessionBucket; count: number }> = [
  { bucket: 'oasa', count: 2 },
  { bucket: 'hong-kong', count: 4 },
  { bucket: 'china', count: 2 },
  { bucket: 'world', count: 2 }
];

const NEWSLETTER_TARGET_ARTICLE_COUNT = NEWSLETTER_SESSION_PLAN.reduce((sum, step) => sum + step.count, 0);

const normalizeArticleText = (value: unknown): string => String(value || '').toLowerCase();

const ARTICLE_HK_KEYWORDS = [
  'hong kong', 'hongkong', 'hksar', 'cyberport', 'hong kong science park', 'hkust', 'hku', '.hk/'
];

const ARTICLE_CHINA_KEYWORDS = [
  'china', 'beijing', 'shanghai', 'shenzhen', 'guangzhou', 'prc', 'mainland'
];

const includesAnyKeyword = (value: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => value.includes(keyword));
};

const isOasaArticle = (article: Article): boolean => {
  const source = normalizeArticleText(article.source);
  const categories = Array.isArray(article.category) ? article.category.map((entry) => normalizeArticleText(entry)) : [];
  const link = normalizeArticleText(article.link);

  return source.includes('oasa') || categories.includes('oasa') || link.includes('oasahk.org/event');
};

const isHongKongArticle = (article: Article): boolean => {
  const region = normalizeArticleText(article.region);
  const source = normalizeArticleText(article.source);
  const title = normalizeArticleText(article.title);
  const description = normalizeArticleText(article.description);
  const link = normalizeArticleText(article.link);
  const categories = Array.isArray(article.category) ? article.category.map((entry) => normalizeArticleText(entry)) : [];
  const categoryText = categories.join(' ');
  const combined = `${source} ${title} ${description} ${link} ${categoryText}`;

  return ['hong-kong', 'hongkong', 'hk'].includes(region)
    || categories.some((entry) => ['hong-kong', 'hongkong', 'hk'].includes(entry))
    || includesAnyKeyword(combined, ARTICLE_HK_KEYWORDS);
};

const isChinaArticle = (article: Article): boolean => {
  if (isHongKongArticle(article)) {
    return false;
  }

  const region = normalizeArticleText(article.region);
  const source = normalizeArticleText(article.source);
  const title = normalizeArticleText(article.title);
  const description = normalizeArticleText(article.description);
  const link = normalizeArticleText(article.link);
  const categories = Array.isArray(article.category) ? article.category.map((entry) => normalizeArticleText(entry)) : [];
  const categoryText = categories.join(' ');
  const combined = `${source} ${title} ${description} ${link} ${categoryText}`;

  return region === 'china'
    || categories.includes('china')
    || includesAnyKeyword(combined, ARTICLE_CHINA_KEYWORDS);
};

const getSessionBucket = (article: Article): SessionBucket => {
  if (isOasaArticle(article)) {
    return 'oasa';
  }

  if (isHongKongArticle(article)) {
    return 'hong-kong';
  }

  if (isChinaArticle(article)) {
    return 'china';
  }

  return 'world';
};

const selectArticlesBySessionPlan = (candidates: Article[]): Article[] => {
  const selected: Article[] = [];
  const selectedIds = new Set<number>();
  const selectedBySource = new Map<string, number>();
  const bucketLimits = new Map<SessionBucket, number>(
    NEWSLETTER_SESSION_PLAN.map((step) => [step.bucket, step.count])
  );
  const selectedByBucket = new Map<SessionBucket, number>();

  const tryTakeArticle = (article: Article): boolean => {
    if (selected.length >= NEWSLETTER_TARGET_ARTICLE_COUNT) {
      return false;
    }

    if (selectedIds.has(article.id)) {
      return false;
    }

    const sourceCount = selectedBySource.get(article.source) || 0;
    if (sourceCount >= getMaxPerSource(article.source)) {
      return false;
    }

    const bucket = getSessionBucket(article);
    const bucketCap = bucketLimits.get(bucket) ?? 0;
    const bucketCount = selectedByBucket.get(bucket) || 0;
    if (bucketCount >= bucketCap) {
      return false;
    }

    selected.push(article);
    selectedIds.add(article.id);
    selectedBySource.set(article.source, sourceCount + 1);
    selectedByBucket.set(bucket, bucketCount + 1);
    return true;
  };

  for (const step of NEWSLETTER_SESSION_PLAN) {
    let needed = step.count;

    for (const article of candidates) {
      if (needed <= 0) {
        break;
      }

      if (getSessionBucket(article) !== step.bucket) {
        continue;
      }

      if (tryTakeArticle(article)) {
        needed--;
      }
    }
  }

  if (selected.length < NEWSLETTER_TARGET_ARTICLE_COUNT) {
    for (const article of candidates) {
      if (selected.length >= NEWSLETTER_TARGET_ARTICLE_COUNT) {
        break;
      }

      tryTakeArticle(article);
    }
  }

  return selected;
};

const pause = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const getEmailDomain = (email: string): string => {
  const atIndex = email.lastIndexOf('@');
  if (atIndex === -1) {
    return '';
  }
  return email.slice(atIndex + 1).toLowerCase();
};

const parseRetryAfterSeconds = (message: string): number | null => {
  const match = message.match(/after\s+(\d+)\s+seconds?/i);
  if (!match) {
    return null;
  }

  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
};

const shouldRefreshBeforeScheduledSend = (frequency: 'daily' | 'weekly' | 'monthly'): boolean => {
  const configured = (process.env.SCHEDULED_SEND_REFRESH_MODE || 'weekly').trim().toLowerCase();

  if (configured === 'always') {
    return true;
  }

  if (configured === 'never') {
    return false;
  }

  if (configured === 'daily-weekly') {
    return frequency === 'daily' || frequency === 'weekly';
  }

  return frequency === 'weekly';
};

const checkContentAvailability = async (frequency: 'daily' | 'weekly' | 'monthly'): Promise<{ hasContent: boolean; articleCount: number }> => {
  try {
    const count = await Article.count();
    return { hasContent: count > 0, articleCount: count };
  } catch (error) {
    console.error('Error checking content availability:', error);
    return { hasContent: true, articleCount: -1 }; // Assume content exists on error
  }
};

const sqlLikeToRegex = (pattern: string): RegExp => {
  const escaped = pattern
    .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
};

const requireAdminToken = (req: Request, res: Response): boolean => {
  const adminToken = process.env.ADMIN_TEST_TOKEN;
  const providedToken = req.header('x-admin-token') || req.query.token;

  if (adminToken && providedToken !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
};

const requireMonitorToken = (req: Request, res: Response): boolean => {
  const monitorToken = process.env.MONITOR_TOKEN || process.env.NEWSLETTER_SENDER_TOKEN;
  const adminToken = process.env.ADMIN_TEST_TOKEN;
  const providedToken = req.header('x-monitor-token') || req.query.token;

  const isMonitorMatch = !!monitorToken && providedToken === monitorToken;
  const isAdminMatch = !!adminToken && providedToken === adminToken;

  if (!isMonitorMatch && !isAdminMatch) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
};

const recordDeliveryAttempt = async (params: {
  email: string;
  triggerType: 'scheduled' | 'test';
  frequency?: 'daily' | 'weekly' | 'monthly';
  success: boolean;
  errorMessage?: string;
  articleCount: number;
}): Promise<void> => {
  try {
    await NewsletterDeliveryLog.create({
      email: params.email,
      triggerType: params.triggerType,
      frequency: params.frequency,
      success: params.success,
      errorMessage: params.errorMessage || null,
      articleCount: params.articleCount,
      deliveredAt: new Date()
    });
  } catch (error) {
    console.error('Failed to record newsletter delivery attempt:', error);
  }
};

export const getLatestArticles = async (req: Request, res: Response): Promise<void> => {
  try {
    const { limit = 10, offset = 0, source, category, region } = req.query;

    const whereClause: any = {};
    if (source) whereClause.source = source;
    if (category) whereClause.category = { [Op.contains]: [category] };
    if (region) whereClause.region = region;

    const articles = await Article.findAll({
      where: whereClause,
      limit: Number(limit),
      offset: Number(offset),
      order: [
        ['priority', 'DESC NULLS LAST'],
        ['pubDate', 'DESC']
      ]
    });

    res.status(200).json({
      articles,
      count: articles.length
    });
  } catch (error) {
    console.error('Get articles error:', error);
    res.status(500).json({ error: 'Failed to fetch articles' });
  }
};

export const getFeaturedArticles = async (req: Request, res: Response): Promise<void> => {
  try {
    const articles = await Article.findAll({
      where: { isFeatured: true },
      limit: 5,
      order: [['pubDate', 'DESC']]
    });

    res.status(200).json({ articles });
  } catch (error) {
    console.error('Get featured articles error:', error);
    res.status(500).json({ error: 'Failed to fetch featured articles' });
  }
};

export const getArticleById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;

    const article = await Article.findByPk(id);
    if (!article) {
      res.status(404).json({ error: 'Article not found' });
      return;
    }

    res.status(200).json({ article });
  } catch (error) {
    console.error('Get article error:', error);
    res.status(500).json({ error: 'Failed to fetch article' });
  }
};

export const sendTestNewsletter = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const adminToken = process.env.ADMIN_TEST_TOKEN;
    const providedToken = req.header('x-admin-token') || req.query.token;
    if (adminToken && providedToken !== adminToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { email } = req.body as { email: string };
    const subscriber = await Subscriber.findOne({ where: { email } });
    if (!subscriber) {
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }

    if (!subscriber.isActive) {
      res.status(400).json({ error: 'Subscriber is inactive' });
      return;
    }

    if (!subscriber.isVerified) {
      res.status(400).json({ error: 'Subscriber is not verified' });
      return;
    }

    const preferenceWhere = buildPreferenceWhere(subscriber);
    const recentThreshold = new Date();
    recentThreshold.setDate(recentThreshold.getDate() - 7);

    const recentCandidates = await Article.findAll({
      where: {
        pubDate: { [Op.gte]: recentThreshold },
        ...preferenceWhere
      },
      limit: 200,
      order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
    });

    const fallbackCandidates = await Article.findAll({
      where: preferenceWhere,
      limit: 200,
      order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
    });

    const recentIds = new Set(recentCandidates.map((article) => article.id));
    const combinedCandidates = [
      ...recentCandidates,
      ...fallbackCandidates.filter((article) => !recentIds.has(article.id))
    ];
    const articles = selectArticlesBySessionPlan(combinedCandidates);

    const preferencesToken = await ensurePreferencesToken(subscriber);
    const emailSent = await sendNewsletterEmail(
      subscriber.email,
      articles,
      subscriber.unsubscribeToken,
      preferencesToken
    );
    if (!emailSent) {
      const sendError = consumeLastEmailSendError(subscriber.email) || 'Email service returned unsuccessful status';
      await recordDeliveryAttempt({
        email: subscriber.email,
        triggerType: 'test',
        frequency: subscriber.frequency,
        success: false,
        errorMessage: sendError,
        articleCount: articles.length
      });
      res.status(500).json({ error: 'Failed to send test newsletter' });
      return;
    }

    await recordDeliveryAttempt({
      email: subscriber.email,
      triggerType: 'test',
      frequency: subscriber.frequency,
      success: true,
      articleCount: articles.length
    });

    res.status(200).json({ message: 'Test newsletter sent' });
  } catch (error) {
    console.error('Send test newsletter error:', error);
    res.status(500).json({ error: 'Failed to send test newsletter' });
  }
};

// POST /api/newsletters/aggregate - Called by Azure Function to pull latest news
export const aggregateNewsletterArticles = async (req: Request, res: Response) => {
  try {
    // Verify token from Azure Function
    const token = req.headers['x-aggregator-token'];
    const expectedToken = process.env.NEWS_AGGREGATOR_TOKEN;
    
    if (!token || token !== expectedToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Run news aggregation
    console.log('Starting news aggregation...');
    const articlesAdded = await aggregateNews();
    
    console.log(`✓ News aggregation completed. Added ${articlesAdded} articles`);
    res.status(200).json({ articlesAdded });
  } catch (error) {
    console.error('Aggregate news error:', error);
    res.status(500).json({ error: 'Failed to aggregate news' });
  }
};

// POST /api/newsletters/send-scheduled - Called by Azure Function to send weekly newsletters
export const sendScheduledNewsletters = async (req: Request, res: Response) => {
  try {
    // Verify token from Azure Function
    const token = req.headers['x-sender-token'];
    const expectedToken = process.env.NEWSLETTER_SENDER_TOKEN;
    
    if (!token || token !== expectedToken) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { frequency = 'weekly', dryRun: bodyDryRun, manual: bodyManual } = req.body as {
      frequency?: 'daily' | 'weekly' | 'monthly';
      dryRun?: boolean;
      manual?: boolean;
    };

    const queryDryRun = typeof req.query.dryRun === 'string' && req.query.dryRun.toLowerCase() === 'true';
    const dryRun = queryDryRun || bodyDryRun === true;

    const queryManual = typeof req.query.manual === 'string' && req.query.manual.toLowerCase() === 'true';
    const manualHeader = (req.header('x-manual-trigger') || '').trim().toLowerCase() === 'true';
    const explicitManual = queryManual || manualHeader || bodyManual === true || Boolean(req.header('x-admin-token'));

    const requestSource = (req.header('x-scheduled-source') || '').trim().toLowerCase();
    const isFunctionSource = requestSource === 'function';
    const requireFunctionSourceHeader = (process.env.REQUIRE_FUNCTION_SOURCE_HEADER || 'false').toLowerCase() === 'true';

    if (requireFunctionSourceHeader && !isFunctionSource) {
      res.status(403).json({
        error: 'Scheduled source header required',
        hint: 'Provide x-scheduled-source=function for trusted function callers'
      });
      return;
    }

    if (explicitManual) {
      const allowManual = (process.env.ALLOW_MANUAL_SCHEDULED_SEND || 'false').toLowerCase() === 'true';
      if (!allowManual) {
        res.status(403).json({
          error: 'Manual scheduled sends are disabled',
          hint: 'Set ALLOW_MANUAL_SCHEDULED_SEND=true and provide manual confirmation token'
        });
        return;
      }

      const expectedManualToken = process.env.MANUAL_SEND_CONFIRMATION_TOKEN || '';
      if (expectedManualToken) {
        const providedManualToken = (req.header('x-manual-send-token') || String(req.query.manualToken || '')).trim();
        if (providedManualToken !== expectedManualToken) {
          res.status(401).json({ error: 'Manual confirmation token required' });
          return;
        }
      }
    }

    if (shouldRefreshBeforeScheduledSend(frequency)) {
      console.log(`Refreshing content before ${frequency} scheduled send...`);
      const articlesAdded = await aggregateNews();
      console.log(`✓ Pre-send refresh completed. Added ${articlesAdded} article(s)`);
    }

    // Check content availability before sending
    const { hasContent, articleCount } = await checkContentAvailability(frequency);
    if (!hasContent) {
      const alertMsg = `⚠️ ALERT: No content available for ${frequency} scheduled send! Total articles in database: 0`;
      console.error(alertMsg);
      res.status(503).json({
        error: 'No content available',
        message: alertMsg,
        frequency,
        articleCount: 0
      });
      return;
    }
    if (articleCount === 0) {
      console.warn(`⚠️ WARNING: Empty article database before sending to ${frequency} subscribers`);
    }

    // Get all verified, active subscribers with matching frequency
    const subscribers = await Subscriber.findAll({
      where: {
        isVerified: true,
        isActive: true,
        frequency
      }
    });

    if (subscribers.length === 0) {
      console.log('No subscribers to send newsletters to');
      res.status(200).json({ sent: 0, failed: 0 });
      return;
    }

    if (dryRun) {
      const recipientPreviewLimit = Number(process.env.MANUAL_SEND_DRYRUN_PREVIEW_LIMIT || 50);
      const recipients = subscribers.map((subscriber) => subscriber.email);
      const domains = recipients.reduce<Record<string, number>>((acc, email) => {
        const domain = getEmailDomain(email) || 'unknown';
        acc[domain] = (acc[domain] || 0) + 1;
        return acc;
      }, {});

      const domainBreakdown = Object.entries(domains)
        .map(([domain, count]) => ({ domain, count }))
        .sort((a, b) => b.count - a.count || a.domain.localeCompare(b.domain));

      res.status(200).json({
        dryRun: true,
        frequency,
        totalRecipients: recipients.length,
        recipientsPreview: recipients.slice(0, Math.max(recipientPreviewLimit, 0)),
        domainBreakdown
      });
      return;
    }

    console.log(`Sending newsletters to ${subscribers.length} subscribers...`);

    let sent = 0;
    let failed = 0;
    const failedRecipients: Array<{ email: string; reason: string }> = [];
    const baseGapMs = Number(process.env.EMAIL_SEND_GAP_MS || 1200);
    const jitterMs = Number(process.env.EMAIL_SEND_JITTER_MS || 700);
    const minDomainCooldownMs = Number(process.env.EMAIL_DOMAIN_MIN_COOLDOWN_MS || 60000);
    const domainCooldownUntil = new Map<string, number>();

    // Send newsletter to each subscriber with deterministic session allocation.
    for (const subscriber of subscribers) {
      try {
        const domain = getEmailDomain(subscriber.email);
        const now = Date.now();
        const cooldownUntil = domain ? domainCooldownUntil.get(domain) || 0 : 0;
        if (cooldownUntil > now) {
          const waitMs = cooldownUntil - now;
          console.warn(`Domain cooldown active for ${domain}; delaying ${subscriber.email} by ${waitMs}ms`);
          await pause(waitMs);
        }

        const preferenceWhere = buildPreferenceWhere(subscriber);
        const freshnessThreshold = new Date();
        freshnessThreshold.setDate(freshnessThreshold.getDate() - 7);

        const recentCandidates: Article[] = await Article.findAll({
          where: {
            pubDate: { [Op.gte]: freshnessThreshold },
            ...preferenceWhere
          },
          limit: 200,
          order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
        });

        const fallbackArticles: Article[] = await Article.findAll({
          where: preferenceWhere,
          limit: 200,
          order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
        });

        const recentIds = new Set(recentCandidates.map((article) => article.id));
        const combinedCandidates = [
          ...recentCandidates,
          ...fallbackArticles.filter((article) => !recentIds.has(article.id))
        ];
        const articles = selectArticlesBySessionPlan(combinedCandidates);

        const preferencesToken = await ensurePreferencesToken(subscriber);
        const emailSent = await sendNewsletterEmail(
          subscriber.email,
          articles,
          subscriber.unsubscribeToken,
          preferencesToken
        );
        if (emailSent) {
          sent++;
          await recordDeliveryAttempt({
            email: subscriber.email,
            triggerType: 'scheduled',
            frequency: subscriber.frequency,
            success: true,
            articleCount: articles.length
          });
        } else {
          failed++;
          const sendError = consumeLastEmailSendError(subscriber.email) || 'Email service returned unsuccessful status';
          console.error(`Failed to send newsletter to ${subscriber.email}`);

          const retryAfterSeconds = parseRetryAfterSeconds(sendError);
          if (domain && sendError.toLowerCase().includes('toomanyrequests')) {
            const cooldownMs = Math.max(
              minDomainCooldownMs,
              retryAfterSeconds !== null ? retryAfterSeconds * 1000 : 0
            );
            domainCooldownUntil.set(domain, Date.now() + cooldownMs);
          }

          await recordDeliveryAttempt({
            email: subscriber.email,
            triggerType: 'scheduled',
            frequency: subscriber.frequency,
            success: false,
            errorMessage: sendError,
            articleCount: articles.length
          });
          failedRecipients.push({
            email: subscriber.email,
            reason: sendError
          });
        }
      } catch (error) {
        failed++;
        console.error(`Error sending newsletter to subscriber:`, error);
        await recordDeliveryAttempt({
          email: subscriber.email,
          triggerType: 'scheduled',
          frequency: subscriber.frequency,
          success: false,
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          articleCount: 0
        });
        failedRecipients.push({
          email: subscriber.email,
          reason: error instanceof Error ? error.message : 'Unknown error'
        });
      }

      // Keep a small gap between sends to avoid provider burst throttling.
      const randomJitter = Math.floor(Math.random() * Math.max(jitterMs, 0));
      await pause(baseGapMs + randomJitter);
    }

    console.log(`✓ Newsletter sending completed. Sent ${sent}, failed ${failed}`);
    res.status(200).json({ sent, failed, failedRecipients });
  } catch (error) {
    console.error('Send scheduled newsletters error:', error);
    res.status(500).json({ error: 'Failed to send newsletters' });
  }
};

export const getDeliveryStatusByEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireMonitorToken(req, res)) {
      return;
    }

    const email = typeof req.query.email === 'string' ? req.query.email.trim().toLowerCase() : '';
    const dateParam = typeof req.query.date === 'string' ? req.query.date.trim() : '';

    if (!email) {
      res.status(400).json({ error: 'Query parameter "email" is required' });
      return;
    }

    if (dateParam && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      res.status(400).json({ error: 'Query parameter "date" must be YYYY-MM-DD' });
      return;
    }

    const rangeStart = dateParam
      ? new Date(`${dateParam}T00:00:00.000Z`)
      : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');
    const rangeEnd = new Date(rangeStart);
    rangeEnd.setUTCDate(rangeEnd.getUTCDate() + 1);

    const deliveries = await NewsletterDeliveryLog.findAll({
      where: {
        email,
        deliveredAt: {
          [Op.gte]: rangeStart,
          [Op.lt]: rangeEnd
        }
      },
      order: [['deliveredAt', 'DESC']],
      limit: 100
    });

    const successful = deliveries.filter(item => item.success).length;
    const failed = deliveries.length - successful;

    res.status(200).json({
      email,
      date: rangeStart.toISOString().slice(0, 10),
      summary: {
        total: deliveries.length,
        successful,
        failed
      },
      deliveries: deliveries.map(item => ({
        triggerType: item.triggerType,
        frequency: item.frequency,
        success: item.success,
        errorMessage: item.errorMessage,
        articleCount: item.articleCount,
        deliveredAt: item.deliveredAt
      }))
    });
  } catch (error) {
    console.error('Get delivery status by email error:', error);
    res.status(500).json({ error: 'Failed to fetch delivery status' });
  }
};

export const listNewsSources = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    await seedDefaultSourcesIfEmpty();

    const sources = await NewsSource.findAll({
      order: [['createdAt', 'ASC']]
    });

    res.status(200).json({ sources });
  } catch (error) {
    console.error('List news sources error:', error);
    res.status(500).json({ error: 'Failed to fetch news sources' });
  }
};

export const createNewsSource = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { url, source, category, region, isActive = true } = req.body as {
      url: string;
      source: string;
      category?: string[];
      region?: string;
      isActive?: boolean;
    };

    const existing = await NewsSource.findOne({ where: { url } });
    if (existing) {
      res.status(409).json({ error: 'Source URL already exists' });
      return;
    }

    const created = await NewsSource.create({
      url,
      source,
      category: category && category.length > 0 ? category : ['space', 'news'],
      region,
      isActive
    });

    res.status(201).json({ source: created });
  } catch (error) {
    console.error('Create news source error:', error);
    res.status(500).json({ error: 'Failed to create news source' });
  }
};

export const deleteNewsSource = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    const { id } = req.params;
    const source = await NewsSource.findByPk(id);

    if (!source) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }

    await source.destroy();
    res.status(200).json({ message: 'Source deleted' });
  } catch (error) {
    console.error('Delete news source error:', error);
    res.status(500).json({ error: 'Failed to delete news source' });
  }
};

export const testNewsSource = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    const { id } = req.params;
    const source = await NewsSource.findByPk(id);

    if (!source) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }

    const feed = await sourceTestParser.parseURL(source.url);
    const items = Array.isArray(feed.items) ? feed.items : [];

    res.status(200).json({
      source: {
        id: source.id,
        name: source.source,
        url: source.url
      },
      feedTitle: feed.title || null,
      itemCount: items.length,
      sampleItems: items.slice(0, 3).map((item) => ({
        title: item.title || 'Untitled',
        link: item.link || null,
        pubDate: item.pubDate || null
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Test news source error:', error);
    res.status(502).json({ error: `Failed to fetch or parse source: ${message}` });
  }
};

export const getAdminChangelog = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    res.status(200).json({
      updatedAt: new Date().toISOString(),
      entries: getAdminChangelogEntries()
    });
  } catch (error) {
    console.error('Get admin changelog error:', error);
    res.status(500).json({ error: 'Failed to fetch admin changelog' });
  }
};

export const getPipelineStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireMonitorToken(req, res)) {
      return;
    }

    const staleThresholdMinutes = Number(process.env.MONITOR_MAX_STALE_MINUTES || 720);
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const previous24Hours = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const now = Date.now();

    // Exclude demo/test recipients from delivery health, configurable via env.
    // Example: MONITOR_EXCLUDED_EMAIL_PATTERNS=%@example.com,%+demo@%,test+%@%
    const excludedEmailPatterns = (process.env.MONITOR_EXCLUDED_EMAIL_PATTERNS
      || '%@example.com,%@example.org,%@example.net,%@test.com,%@test.org,%@test.net')
      .split(',')
      .map(pattern => pattern.trim())
      .filter(Boolean);

    const dailySuccessFreshnessMinutes = 36 * 60;
    const weeklySuccessFreshnessMinutes = 8 * 24 * 60;
    const realRecipientLookbackHours = Number(process.env.MONITOR_REAL_RECIPIENT_LOOKBACK_HOURS || 48);
    const realRecipientListLimit = Number(process.env.MONITOR_REAL_RECIPIENT_LIST_LIMIT || 12);

    const baseScheduledWhere: Record<string, unknown> = {
      triggerType: 'scheduled',
      deliveredAt: { [Op.gte]: last24Hours }
    };

    const scopedScheduledWhere: Record<string, unknown> = excludedEmailPatterns.length > 0
      ? {
          ...baseScheduledWhere,
          [Op.and]: excludedEmailPatterns.map((pattern) => ({
            email: { [Op.notILike]: pattern }
          }))
        }
      : baseScheduledWhere;

    const latestArticle = await Article.findOne({
      order: [['createdAt', 'DESC']]
    });

    const latestCreatedAt = latestArticle?.createdAt ? new Date(latestArticle.createdAt) : null;
    const minutesSinceLatestArticle = latestCreatedAt
      ? Math.floor((Date.now() - latestCreatedAt.getTime()) / (1000 * 60))
      : null;

    const last72Hours = new Date(Date.now() - 72 * 60 * 60 * 1000);
    const [
      articlesLast24h,
      verifiedActive,
      dailySubscribers,
      weeklySubscribers,
      latestDailySuccess,
      latestWeeklySuccess,
      deliveriesLast24h,
      failedDeliveriesLast24h,
      allDeliveriesLast24h,
      allFailedDeliveriesLast24h,
      sourcesBreakdownRaw
    ] = await Promise.all([
      Article.count({ where: { createdAt: { [Op.gte]: last24Hours } } }),
      Subscriber.count({ where: { isVerified: true, isActive: true } }),
      Subscriber.count({ where: { isVerified: true, isActive: true, frequency: 'daily' } }),
      Subscriber.count({ where: { isVerified: true, isActive: true, frequency: 'weekly' } }),
      NewsletterDeliveryLog.findOne({
        where: {
          triggerType: 'scheduled',
          frequency: 'daily',
          success: true
        },
        order: [['deliveredAt', 'DESC']]
      }),
      NewsletterDeliveryLog.findOne({
        where: {
          triggerType: 'scheduled',
          frequency: 'weekly',
          success: true
        },
        order: [['deliveredAt', 'DESC']]
      }),
      NewsletterDeliveryLog.count({
        where: scopedScheduledWhere
      }),
      NewsletterDeliveryLog.count({
        where: {
          ...scopedScheduledWhere,
          success: false
        }
      }),
      NewsletterDeliveryLog.count({
        where: baseScheduledWhere
      }),
      NewsletterDeliveryLog.count({
        where: {
          ...baseScheduledWhere,
          success: false
        }
      }),
      Article.findAll({
        attributes: [
          'source',
          [Article.sequelize!.fn('COUNT', Article.sequelize!.col('id')), 'count'],
          [Article.sequelize!.fn('MAX', Article.sequelize!.col('createdAt')), 'latestCreatedAt']
        ],
        where: { createdAt: { [Op.gte]: last72Hours } },
        group: ['source'],
        order: [[Article.sequelize!.literal('"latestCreatedAt"'), 'DESC']],
        raw: true
      }) as unknown as Promise<Array<{ source: string; count: string; latestCreatedAt: string }>>
    ]);

    const scopedScheduledLast24h = await NewsletterDeliveryLog.findAll({
      attributes: ['email', 'success'],
      where: scopedScheduledWhere,
      raw: true
    }) as Array<{ email: string; success: boolean }>;

    const recipientOutcome = new Map<string, { attempts: number; hasSuccess: boolean }>();
    for (const row of scopedScheduledLast24h) {
      const key = String(row.email || '').toLowerCase();
      if (!key) {
        continue;
      }
      const current = recipientOutcome.get(key) || { attempts: 0, hasSuccess: false };
      current.attempts += 1;
      current.hasSuccess = current.hasSuccess || Boolean(row.success);
      recipientOutcome.set(key, current);
    }

    const recipientsWithAnyAttempt = recipientOutcome.size;
    const recipientsWithFinalSuccess = Array.from(recipientOutcome.values()).filter((item) => item.hasSuccess).length;
    const recipientsWithoutFinalSuccess = recipientsWithAnyAttempt - recipientsWithFinalSuccess;
    const finalOutcomeSuccessRateLast24h = recipientsWithAnyAttempt > 0
      ? recipientsWithFinalSuccess / recipientsWithAnyAttempt
      : 0;

    const domainStats = new Map<string, { total: number; succeeded: number; failed: number }>();
    for (const row of scopedScheduledLast24h) {
      const email = String(row.email || '').toLowerCase();
      const domain = getEmailDomain(email) || 'unknown';
      const current = domainStats.get(domain) || { total: 0, succeeded: 0, failed: 0 };
      current.total += 1;
      if (row.success) {
        current.succeeded += 1;
      } else {
        current.failed += 1;
      }
      domainStats.set(domain, current);
    }

    const domainHealth = Array.from(domainStats.entries())
      .map(([domain, stats]) => ({
        domain,
        total: stats.total,
        succeeded: stats.succeeded,
        failed: stats.failed,
        failureRate: stats.total > 0 ? stats.failed / stats.total : 0
      }))
      .sort((a, b) => b.failed - a.failed || b.total - a.total || a.domain.localeCompare(b.domain))
      .slice(0, 12);

    const scopedScheduledFailures48h = await NewsletterDeliveryLog.findAll({
      attributes: ['errorMessage', 'deliveredAt'],
      where: {
        ...scopedScheduledWhere,
        success: false,
        deliveredAt: { [Op.gte]: previous24Hours }
      },
      raw: true
    }) as Array<{ errorMessage: string | null; deliveredAt: string | Date }>;

    const failureTrendMap = new Map<string, { current: number; previous: number }>();
    for (const row of scopedScheduledFailures48h) {
      const key = (row.errorMessage || 'Unknown failure').trim();
      const deliveredAt = new Date(row.deliveredAt);
      const bucket = failureTrendMap.get(key) || { current: 0, previous: 0 };
      if (deliveredAt >= last24Hours) {
        bucket.current += 1;
      } else {
        bucket.previous += 1;
      }
      failureTrendMap.set(key, bucket);
    }

    const topFailureReasons = Array.from(failureTrendMap.entries())
      .map(([error, counts]) => ({
        error,
        currentCount: counts.current,
        previousCount: counts.previous,
        delta: counts.current - counts.previous
      }))
      .sort((a, b) => b.currentCount - a.currentCount || b.previousCount - a.previousCount || a.error.localeCompare(b.error))
      .slice(0, 5);

    const timelineLimit = Number(process.env.MONITOR_RUN_TIMELINE_LIMIT || 10);
    const runTimelineRaw = await NewsletterDeliveryLog.sequelize!.query<{
      frequency: string;
      runminute: string;
      total: string;
      succeeded: string;
      failed: string;
      rn: string;
    }>(
      `
      with grouped as (
        select
          frequency,
          date_trunc('minute', "deliveredAt") as runMinute,
          count(*) as total,
          count(*) filter (where success = true) as succeeded,
          count(*) filter (where success = false) as failed
        from newsletter_delivery_logs
        where "triggerType"='scheduled'
          and "deliveredAt" >= now() - interval '7 days'
          and frequency in ('daily', 'weekly')
        group by frequency, runMinute
      ), ranked as (
        select *, row_number() over (partition by frequency order by runMinute desc) as rn
        from grouped
      )
      select frequency, runMinute, total, succeeded, failed, rn
      from ranked
      where rn <= :timelineLimit
      order by frequency asc, runMinute desc
      `,
      {
        replacements: { timelineLimit: Math.max(timelineLimit, 1) },
        type: QueryTypes.SELECT
      }
    );

    const runTimeline = runTimelineRaw.map((row) => ({
      frequency: row.frequency,
      runAt: new Date(row.runminute).toISOString(),
      total: Number(row.total),
      succeeded: Number(row.succeeded),
      failed: Number(row.failed)
    }));

    const healthy =
      latestCreatedAt !== null &&
      minutesSinceLatestArticle !== null &&
      minutesSinceLatestArticle <= staleThresholdMinutes;

    const minutesSinceDailySuccess = latestDailySuccess?.deliveredAt
      ? Math.floor((now - new Date(latestDailySuccess.deliveredAt).getTime()) / (1000 * 60))
      : null;

    const minutesSinceWeeklySuccess = latestWeeklySuccess?.deliveredAt
      ? Math.floor((now - new Date(latestWeeklySuccess.deliveredAt).getTime()) / (1000 * 60))
      : null;

    const dailyWorkflowHealthy =
      dailySubscribers === 0
        ? true
        : minutesSinceDailySuccess !== null && minutesSinceDailySuccess <= dailySuccessFreshnessMinutes;

    const weeklyWorkflowHealthy =
      weeklySubscribers === 0
        ? true
        : minutesSinceWeeklySuccess !== null && minutesSinceWeeklySuccess <= weeklySuccessFreshnessMinutes;

    const failureRatioLast24h =
      deliveriesLast24h > 0
        ? failedDeliveriesLast24h / deliveriesLast24h
        : 0;

    const emailDeliveryHealthy = failureRatioLast24h < 0.8;

    const ignoredDeliveriesLast24h = Math.max(allDeliveriesLast24h - deliveriesLast24h, 0);
    const ignoredFailedDeliveriesLast24h = Math.max(allFailedDeliveriesLast24h - failedDeliveriesLast24h, 0);

    const dailySubscriberRows = await Subscriber.findAll({
      where: {
        isVerified: true,
        isActive: true,
        frequency: 'daily'
      },
      attributes: ['email'],
      raw: true
    }) as Array<{ email: string }>;

    const exclusionRegexes = excludedEmailPatterns.map(sqlLikeToRegex);
    const scopedDailyEmails = dailySubscriberRows
      .map((row) => row.email.toLowerCase())
      .filter((email) => !exclusionRegexes.some((regex) => regex.test(email)));

    const successRows = scopedDailyEmails.length > 0
      ? await NewsletterDeliveryLog.findAll({
          attributes: [
            'email',
            [
              NewsletterDeliveryLog.sequelize!.fn('MAX', NewsletterDeliveryLog.sequelize!.col('deliveredAt')),
              'lastSuccessAt'
            ]
          ],
          where: {
            triggerType: 'scheduled',
            frequency: 'daily',
            success: true,
            email: { [Op.in]: scopedDailyEmails }
          },
          group: ['email'],
          raw: true
        }) as unknown as Array<{ email: string; lastSuccessAt: string | null }>
      : [];

    const successByEmail = new Map<string, Date>();
    for (const row of successRows) {
      if (!row.lastSuccessAt) {
        continue;
      }
      successByEmail.set(String(row.email).toLowerCase(), new Date(row.lastSuccessAt));
    }

    const recentSuccessCutoff = new Date(Date.now() - (realRecipientLookbackHours * 60 * 60 * 1000));
    const impactedDailyRecipients = scopedDailyEmails
      .map((email) => {
        const lastSuccessAt = successByEmail.get(email) || null;
        return {
          email,
          lastSuccessAt: lastSuccessAt ? lastSuccessAt.toISOString() : null
        };
      })
      .filter((row) => !row.lastSuccessAt || new Date(row.lastSuccessAt).getTime() < recentSuccessCutoff.getTime())
      .sort((a, b) => {
        if (!a.lastSuccessAt && !b.lastSuccessAt) {
          return a.email.localeCompare(b.email);
        }
        if (!a.lastSuccessAt) {
          return -1;
        }
        if (!b.lastSuccessAt) {
          return 1;
        }
        return new Date(a.lastSuccessAt).getTime() - new Date(b.lastSuccessAt).getTime();
      });

    const services = [
      {
        id: 'api',
        label: 'API Service',
        up: true,
        detail: 'API endpoint responded and monitor status computed'
      },
      {
        id: 'database',
        label: 'Database',
        up: true,
        detail: 'Database queries completed successfully'
      },
      {
        id: 'aggregation',
        label: 'News Aggregation Pipeline',
        up: healthy,
        detail: healthy
          ? `Latest article ${minutesSinceLatestArticle} minute(s) ago`
          : `No fresh article within ${staleThresholdMinutes} minute threshold`
      },
      {
        id: 'daily-workflow',
        label: 'Daily Newsletter Workflow',
        up: dailyWorkflowHealthy,
        detail: dailySubscribers === 0
          ? 'No verified active daily subscribers'
          : (minutesSinceDailySuccess === null
              ? 'No successful daily delivery recorded yet'
              : `Last successful daily delivery ${minutesSinceDailySuccess} minute(s) ago`)
      },
      {
        id: 'weekly-workflow',
        label: 'Weekly Newsletter Workflow',
        up: weeklyWorkflowHealthy,
        detail: weeklySubscribers === 0
          ? 'No verified active weekly subscribers'
          : (minutesSinceWeeklySuccess === null
              ? 'No successful weekly delivery recorded yet'
              : `Last successful weekly delivery ${minutesSinceWeeklySuccess} minute(s) ago`)
      },
      {
        id: 'email-delivery',
        label: 'Email Delivery Health',
        up: emailDeliveryHealthy,
        detail: deliveriesLast24h === 0
          ? 'No scheduled deliveries in the last 24 hours'
          : `${failedDeliveriesLast24h}/${deliveriesLast24h} scheduled deliveries failed in last 24 hours (impacted daily recipients: ${impactedDailyRecipients.length})`
      }
    ];

    const overallUp = services.every(service => service.up);

    res.status(200).json({
      overallUp,
      services,
      healthy,
      staleThresholdMinutes,
      latestArticle: latestArticle
        ? {
            id: latestArticle.id,
            source: latestArticle.source,
            title: latestArticle.title,
            createdAt: latestCreatedAt?.toISOString()
          }
        : null,
      minutesSinceLatestArticle,
      articlesLast24h,
      subscribers: {
        verifiedActive,
        daily: dailySubscribers,
        weekly: weeklySubscribers
      },
      workflows: {
        daily: {
          up: dailyWorkflowHealthy,
          minutesSinceLastSuccess: minutesSinceDailySuccess,
          subscriberCount: dailySubscribers
        },
        weekly: {
          up: weeklyWorkflowHealthy,
          minutesSinceLastSuccess: minutesSinceWeeklySuccess,
          subscriberCount: weeklySubscribers
        }
      },
      deliveryHealth: {
        excludedEmailPatterns,
        deliveriesLast24h,
        failedDeliveriesLast24h,
        failureRatioLast24h,
        allDeliveriesLast24h,
        allFailedDeliveriesLast24h,
        ignoredDeliveriesLast24h,
        ignoredFailedDeliveriesLast24h
      },
      realRecipientRisk: {
        lookbackHours: realRecipientLookbackHours,
        impactedDailyRecipientsCount: impactedDailyRecipients.length,
        recipientsWithoutRecentSuccess: impactedDailyRecipients.slice(0, Math.max(realRecipientListLimit, 0))
      },
      runTimeline,
      deliveryOutcome: {
        attemptFailureRateLast24h: failureRatioLast24h,
        finalOutcomeSuccessRateLast24h,
        recipientsWithAnyAttempt,
        recipientsWithFinalSuccess,
        recipientsWithoutFinalSuccess
      },
      failureTrends: {
        currentWindowHours: 24,
        previousWindowHours: 24,
        topFailureReasons
      },
      domainHealth,
      sourcesBreakdown: sourcesBreakdownRaw.map((row) => ({
        source: row.source,
        articleCount72h: Number(row.count),
        latestArticleAt: row.latestCreatedAt ? new Date(row.latestCreatedAt).toISOString() : null
      })),
      checkedAt: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get pipeline status error:', error);
    res.status(500).json({ error: 'Failed to fetch pipeline status' });
  }
};

export const sendMonitorAlert = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireMonitorToken(req, res)) {
      return;
    }

    const recipientsRaw = process.env.MONITOR_ALERT_EMAILS || process.env.ALERT_EMAIL || '';
    const recipients = recipientsRaw
      .split(',')
      .map(email => email.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      res.status(400).json({ error: 'No monitor recipients configured (MONITOR_ALERT_EMAILS)' });
      return;
    }

    const payload = req.body as {
      subject?: string;
      details?: string;
      status?: Record<string, unknown>;
    };

    const subject = payload.subject || 'NewSpace Newsletter Monitor Alert';
    const details = payload.details || 'Monitoring detected a pipeline issue.';
    const statusJson = payload.status ? JSON.stringify(payload.status, null, 2) : 'No status payload provided';

    const htmlContent = `
      <html>
        <body style="font-family: Arial, sans-serif; line-height: 1.5;">
          <h2>${subject}</h2>
          <p>${details}</p>
          <pre style="background:#f4f4f4;padding:12px;border-radius:6px;overflow:auto;">${statusJson}</pre>
          <p style="font-size:12px;color:#666;">Generated at ${new Date().toISOString()}</p>
        </body>
      </html>
    `;

    let sent = 0;
    let failed = 0;
    for (const email of recipients) {
      const ok = await sendEmail({
        to: email,
        subject,
        htmlContent
      });
      if (ok) {
        sent += 1;
      } else {
        failed += 1;
      }
    }

    res.status(200).json({ sent, failed, recipients });
  } catch (error) {
    console.error('Send monitor alert error:', error);
    res.status(500).json({ error: 'Failed to send monitor alert' });
  }
};
