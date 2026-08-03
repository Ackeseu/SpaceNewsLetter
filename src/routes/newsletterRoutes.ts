import { Router } from 'express';
import { body } from 'express-validator';
import {
  getLatestArticles,
  getFeaturedArticles,
  getArticleById,
  sendTestNewsletter,
  aggregateNewsletterArticles,
  sendScheduledNewsletters,
  getPipelineStatus,
  sendMonitorAlert,
  getDeliveryStatusByEmail,
  listNewsSources,
  createNewsSource,
  deleteNewsSource,
  testNewsSource,
  getAdminChangelog,
  getNewsletterPrioritySettingsAdmin,
  updateNewsletterPrioritySettingsAdmin
} from '../controllers/newsletterController';

const router = Router();

// Get latest articles
router.get('/articles', getLatestArticles);

// Get featured articles
router.get('/articles/featured', getFeaturedArticles);

// Get article by ID
router.get('/articles/:id', getArticleById);

// Admin: news source management
router.get('/sources', listNewsSources);
router.post(
  '/sources',
  [
    body('url').isURL(),
    body('source').isString().trim().notEmpty(),
    body('category').optional().isArray(),
    body('region').optional().isString(),
    body('isActive').optional().isBoolean()
  ],
  createNewsSource
);
router.delete('/sources/:id', deleteNewsSource);
router.post('/sources/:id/test', testNewsSource);
router.get('/admin/changelog', getAdminChangelog);
router.get('/admin/priority-settings', getNewsletterPrioritySettingsAdmin);
router.put('/admin/priority-settings', updateNewsletterPrioritySettingsAdmin);

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

// Monitoring endpoints
router.get('/monitor/status', getPipelineStatus);
router.post('/monitor/alert', sendMonitorAlert);
router.get('/monitor/deliveries', getDeliveryStatusByEmail);

export default router;
