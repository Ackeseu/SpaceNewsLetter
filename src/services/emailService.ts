import { EmailAttachment, EmailClient, EmailMessage } from '@azure/communication-email';
import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
const senderEmail = process.env.SENDER_EMAIL || '';

let emailClient: EmailClient | null = null;

if (connectionString) {
  emailClient = new EmailClient(connectionString);
}

const buildTitleReferenceImage = (title: string): string => {
  const cleaned = title.replace(/\s+/g, ' ').trim() || 'Space Update';
  // Use first 50 chars of title to keep URL reasonable
  const shortTitle = cleaned.length > 50 ? cleaned.substring(0, 50) + '...' : cleaned;
  const text = encodeURIComponent(shortTitle);
  // Space-themed dark blue background with white text
  return `https://placehold.co/640x360/1a2332/ffffff/png?text=${text}&font=roboto`;
};

interface EmailOptions {
  to: string;
  subject: string;
  htmlContent: string;
  attachments?: EmailAttachment[];
}

const TRANSPARENT_PIXEL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y5mQAAAAASUVORK5CYII=';

const getContentTypeExtension = (contentType: string): string => {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('webp')) return 'webp';
  return 'img';
};

const loadLogoBase64 = (): string => {
  const logoPath = path.resolve(__dirname, '../../public/oasa-logo.png');
  if (!fs.existsSync(logoPath)) {
    return TRANSPARENT_PIXEL_BASE64;
  }

  try {
    return fs.readFileSync(logoPath).toString('base64');
  } catch {
    return TRANSPARENT_PIXEL_BASE64;
  }
};

const buildInlineArticleAttachment = async (
  imageUrl: string,
  index: number,
  cid: string,
  logoFallbackBase64: string
): Promise<EmailAttachment> => {
  try {
    const response = await fetch(imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to download image: ${response.status}`);
    }

    const contentTypeHeader = response.headers.get('content-type') || 'image/png';
    const contentType = contentTypeHeader.split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      throw new Error(`Invalid image content-type: ${contentType}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length) {
      throw new Error('Downloaded image is empty');
    }

    return {
      name: `article-${index + 1}.${getContentTypeExtension(contentType)}`,
      contentType,
      contentInBase64: buffer.toString('base64'),
      contentId: cid
    };
  } catch {
    return {
      name: `article-${index + 1}-fallback.png`,
      contentType: 'image/png',
      contentInBase64: logoFallbackBase64,
      contentId: cid
    };
  }
};

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
      },
      attachments: options.attachments
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
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const unsubscribeUrl = `${appUrl}/api/subscriptions/unsubscribe/${unsubscribeToken}`;
  const preferencesUrl = `${appUrl}/api/subscriptions/preferences/${preferencesToken}`;
  const logoCid = 'oasa-header-logo';
  const logoBase64 = loadLogoBase64();

  const articleWithImageCids = await Promise.all(
    articles.map(async (article, index) => {
      const cid = `article-image-${index + 1}`;
      const imageUrl = article.imageUrl || buildTitleReferenceImage(article.title || 'Space update');
      const attachment = await buildInlineArticleAttachment(imageUrl, index, cid, logoBase64);

      return {
        article,
        cid,
        attachment
      };
    })
  );

  const attachments: EmailAttachment[] = [
    {
      name: 'oasa-logo.png',
      contentType: 'image/png',
      contentInBase64: logoBase64,
      contentId: logoCid
    },
    ...articleWithImageCids.map(item => item.attachment)
  ];

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; background-color: #f4f4f4; }
        .container { max-width: 700px; margin: 0 auto; background-color: white; padding: 20px; }
        .header { background-color: #0066cc; color: white; padding: 20px; text-align: center; }
        .header-logo { max-width: 220px; height: auto; margin: 0 auto 14px; display: block; }
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
          <img src="cid:${logoCid}" alt="OASA logo" class="header-logo">
          <h1>OASA NewSpace Newsletter</h1>
          <p>Latest updates from space exploration and the low-altitude economy</p>
        </div>
        
        ${articleWithImageCids.map(({ article, cid }) => {
          return `
          <div class="article">
            <h3>${article.title}</h3>
            <img src="cid:${cid}" alt="${article.title}">
            <p>${article.description}</p>
            <p><a href="${article.link}" class="read-more">Read more →</a></p>
            <p style="font-size: 12px; color: #666;">Source: ${article.source} | ${new Date(article.pubDate).toLocaleDateString()}</p>
          </div>
        `;
        }).join('')}
        
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
    subject: `OASA NewSpace Newsletter - ${new Date().toLocaleDateString()}`,
    htmlContent,
    attachments
  });
};
