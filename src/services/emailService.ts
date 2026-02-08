import { EmailClient, EmailMessage } from '@azure/communication-email';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
const senderEmail = process.env.SENDER_EMAIL || '';

let emailClient: EmailClient | null = null;

if (connectionString) {
  emailClient = new EmailClient(connectionString);
}

interface EmailOptions {
  to: string;
  subject: string;
  htmlContent: string;
}

export const sendEmail = async (options: EmailOptions): Promise<boolean> => {
  if (!emailClient) {
    console.error('Email client not configured. Set AZURE_COMMUNICATION_CONNECTION_STRING');
    return false;
  }

  try {
    const message: EmailMessage = {
      senderAddress: senderEmail,
      content: {
        subject: options.subject,
        html: options.htmlContent
      },
      recipients: {
        to: [{ address: options.to }]
      }
    };

    const poller = await emailClient.beginSend(message);
    const result = await poller.pollUntilDone();

    console.log(`✓ Email sent to ${options.to}, Message ID: ${result.id}`);
    return true;
  } catch (error) {
    console.error('Error sending email:', error);
    return false;
  }
};

export const sendVerificationEmail = async (email: string, token: string): Promise<boolean> => {
  const verificationUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/subscriptions/verify/${token}`;
  
  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .button { background-color: #0066cc; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block; }
        .footer { margin-top: 30px; font-size: 12px; color: #666; }
      </style>
    </head>
    <body>
      <div class="container">
        <h2>Welcome to NewSpace Newsletter!</h2>
        <p>Thank you for subscribing to our newsletter about the latest in space exploration and the low-altitude economy.</p>
        <p>Please verify your email address by clicking the button below:</p>
        <p><a href="${verificationUrl}" class="button">Verify Email Address</a></p>
        <p>Or copy this link: ${verificationUrl}</p>
        <div class="footer">
          <p>If you didn't subscribe to this newsletter, please ignore this email.</p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: email,
    subject: 'Verify your NewSpace Newsletter subscription',
    htmlContent
  });
};

export const sendNewsletterEmail = async (
  email: string,
  articles: any[],
  unsubscribeToken: string
): Promise<boolean> => {
  const unsubscribeUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/subscriptions/unsubscribe/${unsubscribeToken}`;

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; }
        .container { max-width: 700px; margin: 0 auto; background-color: white; padding: 20px; }
        .header { background-color: #0066cc; color: white; padding: 20px; text-align: center; }
        .article { margin: 20px 0; padding: 15px; border-left: 4px solid #0066cc; background-color: #f9f9f9; }
        .article h3 { margin-top: 0; }
        .article img { max-width: 100%; height: auto; margin: 10px 0; }
        .read-more { color: #0066cc; text-decoration: none; font-weight: bold; }
        .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; font-size: 12px; color: #666; text-align: center; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>🚀 NewSpace Newsletter</h1>
          <p>Latest updates from space exploration and the low-altitude economy</p>
        </div>
        
        ${articles.map(article => `
          <div class="article">
            <h3>${article.title}</h3>
            ${article.imageUrl ? `<img src="${article.imageUrl}" alt="${article.title}">` : ''}
            <p>${article.description}</p>
            <p><a href="${article.link}" class="read-more">Read more →</a></p>
            <p style="font-size: 12px; color: #666;">Source: ${article.source} | ${new Date(article.pubDate).toLocaleDateString()}</p>
          </div>
        `).join('')}
        
        <div class="footer">
          <p>You're receiving this email because you subscribed to NewSpace Newsletter.</p>
          <p><a href="${unsubscribeUrl}">Unsubscribe</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  return await sendEmail({
    to: email,
    subject: `NewSpace Newsletter - ${new Date().toLocaleDateString()}`,
    htmlContent
  });
};
