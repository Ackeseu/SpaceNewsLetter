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
  unsubscribeToken: string,
  preferencesToken: string
): Promise<boolean> => {
  const unsubscribeUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/subscriptions/unsubscribe/${unsubscribeToken}`;
  const preferencesUrl = `${process.env.APP_URL || 'http://localhost:3000'}/api/subscriptions/preferences/${preferencesToken}`;

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
        .disclaimer { margin-top: 16px; font-size: 10px; line-height: 1.5; color: #777; text-align: left; }
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
          <p><a href="${preferencesUrl}">Manage preferences</a> | <a href="${unsubscribeUrl}">Unsubscribe</a></p>
          <p class="disclaimer">This communication (and any attachments) is directed in confidence to the addressee(s) listed above, and may not otherwise be distributed, copied or used. The contents of this communication may also be subject to privilege, and all rights to that privilege are expressly claimed and not waived. If you have received this communication in error, please notify us by reply e-mail or by telephone and delete this communication (and any attachments) without making a copy. Before opening or using attachments, you should check them for viruses and defects. We do not accept liability in connection with computer virus, data corruption, delay, interruption, unauthorized access or unauthorized amendment.  本電郵(連同任何附加檔案)只供指定收件人閱讀，內容可能包括只有指定收件人才有權接收的資料。如你並非本電郵的原定收件人，請勿使用、保留、披露、複製、列印、轉發或發放本電郵。如本電郵誤發給你，請從電腦系統刪除本電郵所有複本(包括附加檔案)，並立即通知發件人。 創星匯並不宣稱或保證本電郵不含軟件病毒，也不宣稱或保證本電郵所載資料準確、真實和完整。 如本電郵的指定收件人或其他人因本電郵含有軟件病毒或因本電郵所載資料不準確、不真實或不完整而蒙受損害或損失，創星匯概不承擔法律責任。</p>
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
