import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import Article from '../models/Article';
import Subscriber from '../models/Subscriber';
import NewsletterDeliveryLog from '../models/NewsletterDeliveryLog';
import { sendEmail, sendNewsletterEmail } from '../services/emailService';
import { aggregateNews, seedDefaultSourcesIfEmpty } from '../services/newsAggregator';
import { Op } from 'sequelize';
import crypto from 'crypto';
import NewsSource from '../models/NewsSource';

const ensurePreferencesToken = async (subscriber: Subscriber): Promise<string> => {
  if (subscriber.preferencesToken) {
    return subscriber.preferencesToken;
  }

  subscriber.preferencesToken = crypto.randomBytes(32).toString('hex');
  await subscriber.save();
  return subscriber.preferencesToken;
};

const buildPreferenceWhere = (subscriber: Subscriber): Record<string, unknown> => {
  const whereClause: Record<string, unknown> = {};
  const regions = subscriber.regions || [];
  const topics = subscriber.topics || [];

  if (regions.length > 0 && !regions.includes('global')) {
    whereClause.region = { [Op.in]: regions };
  }

  if (topics.length > 0 && !topics.includes('general')) {
    whereClause.category = { [Op.overlap]: topics };
  }

  return whereClause;
};

const OASA_EVENTS_SOURCE = 'OASA Events';
const DEFAULT_MAX_PER_SOURCE = 2;
const MAX_PER_SOURCE_OVERRIDES: Record<string, number> = {
  [OASA_EVENTS_SOURCE]: 1
};

const getMaxPerSource = (source: string): number => {
  return MAX_PER_SOURCE_OVERRIDES[source] ?? DEFAULT_MAX_PER_SOURCE;
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
  const providedToken = req.header('x-monitor-token') || req.query.token;

  if (!monitorToken || providedToken !== monitorToken) {
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

    const maxArticles = Number(process.env.MAX_ARTICLES_PER_NEWSLETTER || 10);
    const preferenceWhere = buildPreferenceWhere(subscriber);

    const articles = await Article.findAll({
      where: preferenceWhere,
      limit: maxArticles,
      order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
    });

    const preferencesToken = await ensurePreferencesToken(subscriber);
    const emailSent = await sendNewsletterEmail(
      subscriber.email,
      articles,
      subscriber.unsubscribeToken,
      preferencesToken
    );
    if (!emailSent) {
      await recordDeliveryAttempt({
        email: subscriber.email,
        triggerType: 'test',
        frequency: subscriber.frequency,
        success: false,
        errorMessage: 'Email service returned unsuccessful status',
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

    const { frequency = 'weekly' } = req.body;

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

    console.log(`Sending newsletters to ${subscribers.length} subscribers...`);

    let sent = 0;
    let failed = 0;
    const failedRecipients: Array<{ email: string; reason: string }> = [];

    // Send newsletter to each subscriber with diverse articles (max 2 per source)
    for (const subscriber of subscribers) {
      try {
        const maxArticles = 12;
        const preferenceWhere = buildPreferenceWhere(subscriber);
        const freshnessThreshold = new Date();
        freshnessThreshold.setDate(freshnessThreshold.getDate() - 7);
        const selectedBySource = new Map<string, number>();

        const appendArticlesWithCap = (candidates: Article[]): void => {
          for (const article of candidates) {
            if (articles.length >= maxArticles) {
              break;
            }

            const sourceCount = selectedBySource.get(article.source) || 0;
            if (sourceCount >= getMaxPerSource(article.source)) {
              continue;
            }

            articles.push(article);
            selectedBySource.set(article.source, sourceCount + 1);
          }
        };

        const articles: Article[] = [];
        const recentCandidates: Article[] = await Article.findAll({
          where: {
            pubDate: { [Op.gte]: freshnessThreshold },
            ...preferenceWhere
          },
          limit: 200,
          order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
        });
        appendArticlesWithCap(recentCandidates);

        // Step 2: Fallback to older articles only if needed
        if (articles.length < maxArticles) {
          const fallbackArticles: Article[] = await Article.findAll({
            where: {
              id: { [Op.notIn]: articles.map(a => a.id) },
              ...preferenceWhere
            },
            limit: 200,
            order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
          });
          appendArticlesWithCap(fallbackArticles);
        }

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
          console.error(`Failed to send newsletter to ${subscriber.email}`);
          await recordDeliveryAttempt({
            email: subscriber.email,
            triggerType: 'scheduled',
            frequency: subscriber.frequency,
            success: false,
            errorMessage: 'Email service returned unsuccessful status',
            articleCount: articles.length
          });
          failedRecipients.push({
            email: subscriber.email,
            reason: 'Email service returned unsuccessful status'
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

export const getPipelineStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireMonitorToken(req, res)) {
      return;
    }

    const staleThresholdMinutes = Number(process.env.MONITOR_MAX_STALE_MINUTES || 720);
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const latestArticle = await Article.findOne({
      order: [['createdAt', 'DESC']]
    });

    const latestCreatedAt = latestArticle?.createdAt ? new Date(latestArticle.createdAt) : null;
    const minutesSinceLatestArticle = latestCreatedAt
      ? Math.floor((Date.now() - latestCreatedAt.getTime()) / (1000 * 60))
      : null;

    const [articlesLast24h, verifiedActive, dailySubscribers, weeklySubscribers] = await Promise.all([
      Article.count({ where: { createdAt: { [Op.gte]: last24Hours } } }),
      Subscriber.count({ where: { isVerified: true, isActive: true } }),
      Subscriber.count({ where: { isVerified: true, isActive: true, frequency: 'daily' } }),
      Subscriber.count({ where: { isVerified: true, isActive: true, frequency: 'weekly' } })
    ]);

    const healthy =
      latestCreatedAt !== null &&
      minutesSinceLatestArticle !== null &&
      minutesSinceLatestArticle <= staleThresholdMinutes;

    res.status(200).json({
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
