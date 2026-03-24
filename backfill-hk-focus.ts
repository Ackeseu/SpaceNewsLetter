import dotenv from 'dotenv';
import { Op } from 'sequelize';
import { sequelize } from './src/config/database';
import Article from './src/models/Article';

dotenv.config();

const OASA_EVENTS_SOURCE = 'OASA Events';

const HK_KEYWORDS = [
  'hong kong', 'hongkong', 'hksar', 'cyberport', 'hong kong science park', 'hkust', 'hku', '.hk/'
];

const includesAnyKeyword = (value: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => value.includes(keyword));
};

const normalize = (value: unknown): string => String(value || '').toLowerCase();

const isHongKongArticle = (article: Article): boolean => {
  const region = normalize(article.region);
  const source = normalize(article.source);
  const title = normalize(article.title);
  const description = normalize(article.description);
  const link = normalize(article.link);
  const categories = Array.isArray(article.category) ? article.category.map((entry) => normalize(entry)) : [];
  const categoryText = categories.join(' ');
  const combined = `${source} ${title} ${description} ${link} ${categoryText}`;

  return ['hong-kong', 'hongkong', 'hk'].includes(region)
    || categories.some((entry) => ['hong-kong', 'hongkong', 'hk'].includes(entry))
    || includesAnyKeyword(combined, HK_KEYWORDS);
};

const run = async (): Promise<void> => {
  const mode = (process.env.HK_FOCUS_CLEANUP_MODE || 'deprioritize').toLowerCase();
  const dryRun = (process.env.HK_FOCUS_CLEANUP_DRY_RUN || 'true').toLowerCase() === 'true';
  const olderThanDays = Number(process.env.HK_FOCUS_CLEANUP_DAYS || 14);
  const minKeepPriority = Number(process.env.HK_FOCUS_NON_HK_PRIORITY || 60);

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

  try {
    await sequelize.authenticate({ logging: false });

    const candidates = await Article.findAll({
      where: {
        source: { [Op.ne]: OASA_EVENTS_SOURCE },
        pubDate: { [Op.lt]: cutoffDate }
      },
      order: [['pubDate', 'DESC']],
      logging: false
    });

    const targets = candidates.filter((article) => !isHongKongArticle(article));

    if (targets.length === 0) {
      console.log('No non-HK older articles found. Nothing to clean up.');
      return;
    }

    console.log(`Found ${targets.length} non-HK older articles (mode=${mode}, dryRun=${dryRun}).`);

    if (dryRun) {
      console.log('Dry run complete. No changes were written.');
      return;
    }

    if (mode === 'delete') {
      const ids = targets.map((article) => article.id);
      const deleted = await Article.destroy({ where: { id: { [Op.in]: ids } }, logging: false });
      console.log(`✓ Cleanup complete. Deleted ${deleted} articles.`);
      return;
    }

    let updated = 0;
    for (const article of targets) {
      const currentPriority = Number.isFinite(article.priority as number) ? Number(article.priority) : 0;
      const newPriority = Math.min(currentPriority, minKeepPriority);

      if (article.priority === newPriority && article.isFeatured === false) {
        continue;
      }

      article.priority = newPriority;
      article.isFeatured = false;
      await article.save({ logging: false });
      updated++;
    }

    console.log(`✓ Cleanup complete. De-prioritized ${updated} articles.`);
  } catch (error) {
    console.error('HK focus cleanup failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

run();
