import { Router } from 'express';
import { body } from 'express-validator';
import {
  subscribe,
  resendVerification,
  unsubscribe,
  verify,
  getPreferences,
  updatePreferences,
  getSubscriberStats,
  listAllSubscribers
} from '../controllers/subscriptionController';

const router = Router();

// Admin: subscriber stats (place before dynamic routes)
router.get('/stats', getSubscriberStats);

// Admin: list all subscribers (place before dynamic routes)
router.get('/admin/list', listAllSubscribers);

// Subscribe to newsletter
router.post(
  '/subscribe',
  [
    body('email').isEmail().normalizeEmail(),
    body('frequency').optional().isIn(['daily', 'weekly', 'monthly']),
    body('topics').optional().isArray(),
    body('regions').optional().isArray()
  ],
  subscribe
);

// Resend verification email
router.post(
  '/resend-verification',
  [
    body('email').isEmail().normalizeEmail()
  ],
  resendVerification
);

// Unsubscribe from newsletter
router.get('/unsubscribe/:token', unsubscribe);

// Verify email
router.get('/verify/:token', verify);

// Get preferences by token
router.get('/preferences/:token', getPreferences);

// Update preferences by token
router.put(
  '/preferences/:token',
  [
    body('frequency').optional().isIn(['daily', 'weekly', 'monthly']),
    body('topics').optional().isArray(),
    body('regions').optional().isArray()
  ],
  updatePreferences
);

export default router;
