import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import Article from '../models/Article';
import Subscriber from '../models/Subscriber';
import { sendNewsletterEmail } from '../services/emailService';
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

const requireAdminToken = (req: Request, res: Response): boolean => {
  const adminToken = process.env.ADMIN_TEST_TOKEN;
  const providedToken = req.header('x-admin-token') || req.query.token;

  if (adminToken && providedToken !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }

  return true;
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
    
    // Step 1: Get all Hong Kong priority articles first
    const hongKongArticles = await Article.findAll({
      where: {
        priority: { [Op.gte]: 100 }
      },
      limit: 3,
      order: [['priority', 'DESC'], ['pubDate', 'DESC']]
    });

    let articles: any[] = [...hongKongArticles];
    const remainingSlots = maxArticles - articles.length;

    if (remainingSlots > 0) {
      // Step 2: Get diverse business-focused articles from different sources
      const sources = await Article.findAll({
        attributes: ['source'],
        where: preferenceWhere,
        group: ['source'],
        raw: true
      }) as Array<{ source: string }>;

      const articlesPerSource = Math.min(2, Math.ceil(remainingSlots / sources.length));
      
      for (const { source } of sources) {
        if (articles.length >= maxArticles) break;
        
        const sourceArticles = await Article.findAll({
          where: {
            source,
            id: { [Op.notIn]: articles.map(a => a.id) },
            priority: { [Op.gte]: 0 },
            ...preferenceWhere
          },
          limit: articlesPerSource,
          order: [['priority', 'DESC'], ['pubDate', 'DESC']]
        });
        articles.push(...sourceArticles);
      }
    }
    
    // Step 3: Fill remaining slots with latest articles
    if (articles.length < maxArticles) {
      const additionalArticles = await Article.findAll({
        where: {
          id: { [Op.notIn]: articles.map(a => a.id) },
          ...preferenceWhere
        },
        limit: maxArticles - articles.length,
        order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
      });
      articles.push(...additionalArticles);
    }

    const preferencesToken = await ensurePreferencesToken(subscriber);
    const emailSent = await sendNewsletterEmail(
      subscriber.email,
      articles,
      subscriber.unsubscribeToken,
      preferencesToken
    );
    if (!emailSent) {
      res.status(500).json({ error: 'Failed to send test newsletter' });
      return;
    }

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

        // Step 1: Prioritize Hong Kong articles (up to 3)
        const hongKongArticles: Article[] = await Article.findAll({
          where: {
            priority: { [Op.gte]: 100 }
          },
          limit: 3,
          order: [['priority', 'DESC'], ['pubDate', 'DESC']]
        });

        const articles: Article[] = [...hongKongArticles];

        // Step 2: Get diverse business-focused articles from different sources
        const sources = await Article.findAll({
          attributes: [[Article.sequelize!.fn('DISTINCT', Article.sequelize!.col('source')), 'source']],
          where: preferenceWhere,
          raw: true
        });

        const sourceList = (sources as any[]).map(s => s.source).filter(Boolean);
        const articlesPerSource = 2;

        for (const source of sourceList) {
          if (articles.length >= maxArticles) break;
          
          const sourceArticles: Article[] = await Article.findAll({
            where: {
              source,
              id: { [Op.notIn]: articles.map(a => a.id) },
              priority: { [Op.gte]: 0 },
              ...preferenceWhere
            },
            limit: articlesPerSource,
            order: [['priority', 'DESC'], ['pubDate', 'DESC']]
          });
          articles.push(...sourceArticles);
        }

        // Step 3: Fill remaining slots with latest business articles
        if (articles.length < maxArticles) {
          const additionalArticles = await Article.findAll({
            where: {
              id: { [Op.notIn]: articles.map(a => a.id) },
              ...preferenceWhere
            },
            limit: maxArticles - articles.length,
            order: [['priority', 'DESC NULLS LAST'], ['pubDate', 'DESC']]
          });
          articles.push(...additionalArticles);
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
        } else {
          failed++;
          console.error(`Failed to send newsletter to ${subscriber.email}`);
          failedRecipients.push({
            email: subscriber.email,
            reason: 'Email service returned unsuccessful status'
          });
        }
      } catch (error) {
        failed++;
        console.error(`Error sending newsletter to subscriber:`, error);
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
