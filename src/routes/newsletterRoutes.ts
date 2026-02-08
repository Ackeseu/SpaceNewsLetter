import { Router } from 'express';
import { body } from 'express-validator';
import {
  getLatestArticles,
  getFeaturedArticles,
  getArticleById,
  sendTestNewsletter,
  aggregateNewsletterArticles,
  sendScheduledNewsletters
} from '../controllers/newsletterController';

const router = Router();

// Get latest articles
router.get('/articles', getLatestArticles);

// Get featured articles
router.get('/articles/featured', getFeaturedArticles);

// Get article by ID
router.get('/articles/:id', getArticleById);

// Send test newsletter
router.post(
  '/send-test',
  [
    body('email').isEmail().normalizeEmail()
  ],
  sendTestNewsletter
);

// Azure Function: Aggregate news
router.post('/aggregate', aggregateNewsletterArticles);

// Azure Function: Send scheduled newsletters
router.post('/send-scheduled', sendScheduledNewsletters);

export default router;
