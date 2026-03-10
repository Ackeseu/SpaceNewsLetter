import dotenv from 'dotenv';
import { Op } from 'sequelize';
import crypto from 'crypto';
import Article from './src/models/Article';
import { sequelize } from './src/config/database';

dotenv.config();

const AI_TITLE_IMAGES_ENABLED = (process.env.AI_TITLE_IMAGES_ENABLED || 'true').toLowerCase() !== 'false';

const buildAiTitleImageUrl = (title: string): string => {
  const cleaned = title.replace(/\s+/g, ' ').trim() || 'Space Update';
  const clippedTitle = cleaned.slice(0, 140);
  const prompt = `space news illustration cinematic inspired by: ${clippedTitle}, no text, no logos`;
  const seed = crypto.createHash('sha256').update(cleaned.toLowerCase()).digest('hex').slice(0, 12);
  const encodedPrompt = encodeURIComponent(prompt);
  return `https://image.pollinations.ai/prompt/${encodedPrompt}?width=640&height=360&nologo=true&seed=${seed}`;
};

const runBackfill = async () => {
  if (!AI_TITLE_IMAGES_ENABLED) {
    console.log('AI title images disabled via AI_TITLE_IMAGES_ENABLED=false. Exiting.');
    return;
  }

  await sequelize.authenticate();

  const batchSize = 200;
  let lastId = 0;
  let updated = 0;
  let scanned = 0;

  while (true) {
    const articles = await Article.findAll({
      where: {
        id: {
          [Op.gt]: lastId
        }
      },
      order: [['id', 'ASC']],
      limit: batchSize
    });

    if (articles.length === 0) {
      break;
    }

    lastId = articles[articles.length - 1].id;

    for (const article of articles) {
      scanned += 1;
      if (article.imageUrl && article.imageUrl.trim().length > 0) {
        continue;
      }

      article.imageUrl = buildAiTitleImageUrl(article.title);
      await article.save();
      updated += 1;
    }

    console.log(`Scanned ${scanned} records, updated ${updated}`);
  }

  console.log(`Done. Updated ${updated} articles with AI title images.`);
};

runBackfill()
  .catch((error) => {
    console.error('Backfill failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sequelize.close();
  });
