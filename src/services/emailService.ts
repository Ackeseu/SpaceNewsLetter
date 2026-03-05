import Handlebars from 'handlebars';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import crypto from 'crypto';

type EmailAttachment = {
  name: string;
  contentType: string;
  contentInBase64: string;
  contentId?: string;
};

type EmailMessage = {
  senderAddress: string;
  content: {
    subject: string;
    html: string;
  };
  recipients: {
    to: Array<{ address: string }>;
  };
  attachments?: EmailAttachment[];
};

type EmailClientLike = {
  beginSend: (message: EmailMessage) => Promise<{
    pollUntilDone: () => Promise<{ id?: string }>;
  }>;
};

const connectionString = process.env.AZURE_COMMUNICATION_CONNECTION_STRING || '';
const senderEmail = process.env.SENDER_EMAIL || '';
const imageCacheEnabled = (process.env.IMAGE_CACHE_ENABLED || 'true').toLowerCase() !== 'false';
const imageCacheDir = process.env.IMAGE_CACHE_DIR || '/home/data/title-image-cache';
const imageCacheTtlHours = Number(process.env.IMAGE_CACHE_TTL_HOURS || 24 * 14);
const imageCachePlaceholderTtlHours = Number(process.env.IMAGE_CACHE_PLACEHOLDER_TTL_HOURS || 6);
const aiImageProvider = (process.env.AI_IMAGE_PROVIDER || 'pollinations').toLowerCase();
const openAiApiKey = process.env.OPENAI_API_KEY || '';
const openAiImageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

let emailClient: EmailClientLike | null = null;

if (connectionString) {
  try {
    // Lazy runtime load prevents hard startup failure if the SDK is unavailable at boot.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { EmailClient } = require('@azure/communication-email') as { EmailClient: new (value: string) => EmailClientLike };
    emailClient = new EmailClient(connectionString);
  } catch (error) {
    console.error('Email SDK unavailable:', error instanceof Error ? error.message : String(error));
    emailClient = null;
  }
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

type CachedImagePayload = {
  contentType: string;
  contentInBase64: string;
  savedAt: string;
  source?: 'generated' | 'placeholder';
};

const isAiTitleImageUrl = (imageUrl: string): boolean => /image\.pollinations\.ai\/prompt\//i.test(imageUrl);

const getImageCacheKey = (title: string): string => {
  const normalizedTitle = title.toLowerCase().trim();
  return crypto.createHash('sha256').update(normalizedTitle).digest('hex').slice(0, 24);
};

const ensureImageCacheDir = async (): Promise<void> => {
  if (!imageCacheEnabled) {
    return;
  }

  await fs.promises.mkdir(imageCacheDir, { recursive: true });
};

const getCachedImagePayload = async (cacheKey: string): Promise<CachedImagePayload | null> => {
  if (!imageCacheEnabled) {
    return null;
  }

  try {
    const cachePath = path.join(imageCacheDir, `${cacheKey}.json`);
    const raw = await fs.promises.readFile(cachePath, 'utf-8');
    const parsed = JSON.parse(raw) as CachedImagePayload;
    const savedAt = new Date(parsed.savedAt).getTime();

    if (Number.isNaN(savedAt)) {
      return null;
    }

    const ageHours = (Date.now() - savedAt) / (1000 * 60 * 60);
    const source = parsed.source === 'generated' ? 'generated' : 'placeholder';
    const ttlHours = source === 'generated' ? imageCacheTtlHours : imageCachePlaceholderTtlHours;

    if (ageHours > ttlHours) {
      return null;
    }

    if (!parsed.contentType || !parsed.contentInBase64) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
};

const setCachedImagePayload = async (cacheKey: string, payload: CachedImagePayload): Promise<void> => {
  if (!imageCacheEnabled) {
    return;
  }

  try {
    await ensureImageCacheDir();
    const cachePath = path.join(imageCacheDir, `${cacheKey}.json`);
    await fs.promises.writeFile(cachePath, JSON.stringify(payload), 'utf-8');
  } catch {
    // ignore cache write failures
  }
};

const buildImageGenerationPrompt = (title: string): string => {
  const cleaned = title.replace(/\s+/g, ' ').trim() || 'Space Update';
  return `Cinematic, editorial-style space news illustration for: ${cleaned}. No text, no logos, no watermarks.`;
};

const tryGenerateOpenAiTitleImage = async (title: string): Promise<CachedImagePayload | null> => {
  if (!openAiApiKey) {
    return null;
  }

  try {
    const prompt = buildImageGenerationPrompt(title);
    const response = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${openAiApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: openAiImageModel,
        prompt,
        size: '1024x1024'
      })
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = data?.data?.[0];
    if (!first) {
      return null;
    }

    if (first.b64_json) {
      return {
        contentType: 'image/png',
        contentInBase64: first.b64_json,
        savedAt: new Date().toISOString(),
        source: 'generated'
      };
    }

    if (first.url) {
      const generatedResponse = await fetch(first.url);
      if (!generatedResponse.ok) {
        return null;
      }

      const generatedType = (generatedResponse.headers.get('content-type') || 'image/png')
        .split(';')[0]
        .trim()
        .toLowerCase();
      const generatedBuffer = Buffer.from(await generatedResponse.arrayBuffer());
      if (!generatedType.startsWith('image/') || generatedBuffer.length === 0) {
        return null;
      }

      return {
        contentType: generatedType,
        contentInBase64: generatedBuffer.toString('base64'),
        savedAt: new Date().toISOString(),
        source: 'generated'
      };
    }

    return null;
  } catch {
    return null;
  }
};

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
  title: string,
  index: number,
  cid: string
): Promise<EmailAttachment> => {
  const cacheKey = getImageCacheKey(title);
  const isAiImage = isAiTitleImageUrl(imageUrl);

  if (isAiImage) {
    const cachedPayload = await getCachedImagePayload(cacheKey);
    if (cachedPayload) {
      return {
        name: `article-${index + 1}.${getContentTypeExtension(cachedPayload.contentType)}`,
        contentType: cachedPayload.contentType,
        contentInBase64: cachedPayload.contentInBase64,
        contentId: cid
      };
    }
  }

  if (isAiImage && aiImageProvider === 'openai') {
    const generatedPayload = await tryGenerateOpenAiTitleImage(title);
    if (generatedPayload) {
      await setCachedImagePayload(cacheKey, generatedPayload);

      return {
        name: `article-${index + 1}.${getContentTypeExtension(generatedPayload.contentType)}`,
        contentType: generatedPayload.contentType,
        contentInBase64: generatedPayload.contentInBase64,
        contentId: cid
      };
    }
  }

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

    if (isAiImage) {
      await setCachedImagePayload(cacheKey, {
        contentType,
        contentInBase64: buffer.toString('base64'),
        savedAt: new Date().toISOString(),
        source: 'generated'
      });
    }

    return {
      name: `article-${index + 1}.${getContentTypeExtension(contentType)}`,
      contentType,
      contentInBase64: buffer.toString('base64'),
      contentId: cid
    };
  } catch {
    try {
      const placeholderUrl = buildTitleReferenceImage(title);
      const placeholderResponse = await fetch(placeholderUrl);
      if (placeholderResponse.ok) {
        const placeholderType = (placeholderResponse.headers.get('content-type') || 'image/png')
          .split(';')[0]
          .trim()
          .toLowerCase();
        const placeholderBuffer = Buffer.from(await placeholderResponse.arrayBuffer());
        if (placeholderBuffer.length > 0 && placeholderType.startsWith('image/')) {
          if (isAiImage) {
            await setCachedImagePayload(cacheKey, {
              contentType: placeholderType,
              contentInBase64: placeholderBuffer.toString('base64'),
              savedAt: new Date().toISOString(),
              source: 'placeholder'
            });
          }

          return {
            name: `article-${index + 1}-placeholder.${getContentTypeExtension(placeholderType)}`,
            contentType: placeholderType,
            contentInBase64: placeholderBuffer.toString('base64'),
            contentId: cid
          };
        }
      }
    } catch {
      // fall through to tiny pixel fallback
    }

    return {
      name: `article-${index + 1}-fallback.png`,
      contentType: 'image/png',
      contentInBase64: TRANSPARENT_PIXEL_BASE64,
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
      const attachment = await buildInlineArticleAttachment(
        imageUrl,
        article.title || 'Space update',
        index,
        cid
      );

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
