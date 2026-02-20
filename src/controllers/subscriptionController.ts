import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import Subscriber from '../models/Subscriber';
import crypto from 'crypto';
import { sendVerificationEmail } from '../services/emailService';

const requireAdminToken = (req: Request, res: Response): boolean => {
  const adminToken = process.env.ADMIN_TEST_TOKEN;
  const providedToken = req.header('x-admin-token') || req.query.token;
  if (adminToken && providedToken !== adminToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
};

export const subscribe = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email, firstName, lastName, frequency, topics, regions } = req.body;

    // Check if subscriber already exists
    const existingSubscriber = await Subscriber.findOne({ where: { email } });
    if (existingSubscriber) {
      if (existingSubscriber.isActive) {
        res.status(400).json({ error: 'Email already subscribed' });
        return;
      }
      // Reactivate if previously unsubscribed
      existingSubscriber.isActive = true;
      existingSubscriber.frequency = frequency || existingSubscriber.frequency;
      existingSubscriber.topics = topics || existingSubscriber.topics;
      existingSubscriber.regions = regions || existingSubscriber.regions;
      await existingSubscriber.save();
      res.status(200).json({ message: 'Subscription reactivated', subscriber: existingSubscriber });
      return;
    }

    // Create new subscriber
    const verificationToken = crypto.randomBytes(32).toString('hex');
    const unsubscribeToken = crypto.randomBytes(32).toString('hex');
    const preferencesToken = crypto.randomBytes(32).toString('hex');

    const subscriber = await Subscriber.create({
      email,
      firstName,
      lastName,
      frequency: frequency || 'weekly',
      topics: topics || ['general'],
      regions: regions || ['global'],
      verificationToken,
      unsubscribeToken,
      preferencesToken,
      isVerified: false,
      isActive: true
    });

    const emailSent = await sendVerificationEmail(subscriber.email, verificationToken);

    res.status(201).json({
      message: emailSent
        ? 'Subscription successful! Please check your email to verify.'
        : 'Subscription created, but verification email failed to send. Please request a resend.',
      subscriber: {
        id: subscriber.id,
        email: subscriber.email,
        frequency: subscriber.frequency
      }
    });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
};

export const resendVerification = async (req: Request, res: Response): Promise<void> => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res.status(400).json({ errors: errors.array() });
      return;
    }

    const { email } = req.body;
    const subscriber = await Subscriber.findOne({ where: { email } });
    if (!subscriber) {
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }

    if (subscriber.isVerified) {
      res.status(400).json({ error: 'Email already verified' });
      return;
    }

    if (!subscriber.verificationToken) {
      subscriber.verificationToken = crypto.randomBytes(32).toString('hex');
      await subscriber.save();
    }

    const emailSent = await sendVerificationEmail(subscriber.email, subscriber.verificationToken);
    if (!emailSent) {
      res.status(500).json({ error: 'Failed to send verification email' });
      return;
    }

    res.status(200).json({ message: 'Verification email resent' });
  } catch (error) {
    console.error('Resend verification error:', error);
    res.status(500).json({ error: 'Failed to resend verification email' });
  }
};

export const unsubscribe = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    const subscriber = await Subscriber.findOne({ where: { unsubscribeToken: token } });
    if (!subscriber) {
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }

    subscriber.isActive = false;
    await subscriber.save();

    res.status(200).json({ message: 'Successfully unsubscribed' });
  } catch (error) {
    console.error('Unsubscribe error:', error);
    res.status(500).json({ error: 'Failed to unsubscribe' });
  }
};

export const verify = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;

    const subscriber = await Subscriber.findOne({ where: { verificationToken: token } });
    if (!subscriber) {
      res.status(404).redirect('/verified.html?error=invalid');
      return;
    }

    subscriber.isVerified = true;
    subscriber.verificationToken = undefined;
    await subscriber.save();

    res.redirect('/verified.html');
  } catch (error) {
    console.error('Verify error:', error);
    res.status(500).redirect('/verified.html?error=failed');
  }
};

export const getPreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const subscriber = await Subscriber.findOne({ where: { preferencesToken: token } });
    if (!subscriber) {
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }

    res.status(200).json({
      email: subscriber.email,
      frequency: subscriber.frequency,
      topics: subscriber.topics,
      regions: subscriber.regions,
      isActive: subscriber.isActive,
      isVerified: subscriber.isVerified
    });
  } catch (error) {
    console.error('Get preferences error:', error);
    res.status(500).json({ error: 'Failed to fetch preferences' });
  }
};

export const updatePreferences = async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.params;
    const { frequency, topics, regions } = req.body;

    console.log(`Updating preferences for token: ${token}`, { frequency, topics, regions });

    const subscriber = await Subscriber.findOne({ where: { preferencesToken: token } });
    if (!subscriber) {
      console.error(`Subscriber not found for token: ${token}`);
      res.status(404).json({ error: 'Subscriber not found' });
      return;
    }

    if (frequency) {
      subscriber.frequency = frequency;
      console.log(`Updated frequency from ${subscriber.getDataValue('frequency')} to ${frequency}`);
    }
    if (topics && Array.isArray(topics)) subscriber.topics = topics;
    if (regions && Array.isArray(regions)) subscriber.regions = regions;
    
    await subscriber.save();
    console.log(`Preferences saved for ${subscriber.email}`);

    // Return fully refreshed subscriber object
    const updated = await Subscriber.findOne({ where: { preferencesToken: token } });
    res.status(200).json({ message: 'Preferences updated', subscriber: updated });
  } catch (error) {
    console.error('Update preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences' });
  }
};

export const getSubscriberStats = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    const [total, active, verified, activeVerified, unsubscribed] = await Promise.all([
      Subscriber.count(),
      Subscriber.count({ where: { isActive: true } }),
      Subscriber.count({ where: { isVerified: true } }),
      Subscriber.count({ where: { isActive: true, isVerified: true } }),
      Subscriber.count({ where: { isActive: false } })
    ]);

    res.status(200).json({
      total,
      active,
      verified,
      activeVerified,
      unsubscribed
    });
  } catch (error) {
    console.error('Get subscriber stats error:', error);
    res.status(500).json({ error: 'Failed to fetch subscriber stats' });
  }
};

export const listAllSubscribers = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    const subscribers = await Subscriber.findAll({
      attributes: ['id', 'email', 'firstName', 'lastName', 'isVerified', 'isActive', 'frequency', 'topics', 'regions', 'preferencesToken', 'unsubscribeToken'],
      where: { isActive: true },
      order: [['createdAt', 'DESC']]
    });

    res.status(200).json(subscribers);
  } catch (error) {
    console.error('List subscribers error:', error);
    res.status(500).json({ error: 'Failed to fetch subscribers' });
  }
};

export const resendVerificationToUnverified = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!requireAdminToken(req, res)) {
      return;
    }

    const { emailDomain } = req.query;
    const { Op } = require('sequelize');

    // Get all unverified subscribers
    let where: Record<string, any> = { isVerified: false };
    if (emailDomain) {
      // Filter by email domain if provided
      where.email = { [Op.like]: `%@${emailDomain}` };
    }

    const unverified = await Subscriber.findAll({ where });

    if (unverified.length === 0) {
      res.status(200).json({ message: 'No unverified subscribers found', count: 0 });
      return;
    }

    const { sendVerificationEmail } = require('../services/emailService');
    let successCount = 0;
    const failedEmails: string[] = [];

    for (const subscriber of unverified) {
      if (!subscriber.verificationToken) {
        subscriber.verificationToken = crypto.randomBytes(32).toString('hex');
        await subscriber.save();
      }

      const emailSent = await sendVerificationEmail(subscriber.email, subscriber.verificationToken);
      if (emailSent) {
        successCount++;
      } else {
        failedEmails.push(subscriber.email);
      }
    }

    res.status(200).json({
      message: 'Verification emails resent',
      totalUnverified: unverified.length,
      successCount,
      failedEmails
    });
  } catch (error) {
    console.error('Resend verification to unverified error:', error);
    res.status(500).json({ error: 'Failed to resend verification emails' });
  }
};
