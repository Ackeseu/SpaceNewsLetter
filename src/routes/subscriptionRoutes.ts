import { Router } from 'express';
import { body } from 'express-validator';
import {
  subscribe,
  resendVerification,
  unsubscribe,
  verify,
  updatePreferences
} from '../controllers/subscriptionController';

const router = Router();

// Subscribe to newsletter
router.post(
  '/subscribe',
  [
    body('email').isEmail().normalizeEmail(),
    body('frequency').optional().isIn(['daily', 'weekly', 'monthly']),
    body('topics').optional().isArray()
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

// Update preferences
router.put(
  '/preferences/:id',
  [
    body('frequency').optional().isIn(['daily', 'weekly', 'monthly']),
    body('topics').optional().isArray()
  ],
  updatePreferences
);

export default router;
