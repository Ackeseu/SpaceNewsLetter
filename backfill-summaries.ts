import dotenv from 'dotenv';
import { Op } from 'sequelize';
import { sequelize } from './src/config/database';
import Article from './src/models/Article';
import { buildArticleSummary } from './src/utils/articleSummary';

dotenv.config();

const OASA_EVENTS_SOURCE = 'OASA Events';
const BATCH_SIZE = 200;

const runBackfill = async (): Promise<void> => {
  try {
    console.log('Starting non-OASA summary backfill...');

    await sequelize.authenticate({ logging: false });

    const articles = await Article.findAll({
      where: {
        source: {
          [Op.ne]: OASA_EVENTS_SOURCE
        }
      },
      order: [['id', 'ASC']],
      logging: false
    });

    if (articles.length === 0) {
      console.log('No non-OASA articles found. Nothing to update.');
      return;
    }

    console.log(`Found ${articles.length} non-OASA articles.`);

    let updatedCount = 0;
    let skippedCount = 0;

    for (let index = 0; index < articles.length; index += BATCH_SIZE) {
      const batch = articles.slice(index, index + BATCH_SIZE);

      for (const article of batch) {
        const newSummary = buildArticleSummary(article.title, article.description || '');

        if (article.description === newSummary) {
          skippedCount++;
          continue;
        }

        article.description = newSummary;
        await article.save({ logging: false });
        updatedCount++;
      }

      console.log(`Processed ${Math.min(index + BATCH_SIZE, articles.length)}/${articles.length}...`);
    }

    console.log(`✓ Backfill complete. Updated: ${updatedCount}, unchanged: ${skippedCount}`);
  } catch (error) {
    console.error('✗ Backfill failed:', error);
    process.exitCode = 1;
  } finally {
    await sequelize.close();
  }
};

runBackfill();
