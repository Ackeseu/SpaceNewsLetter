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
const OASA_EVENTS_SOURCE = 'OASA Events';
const aiImageProvider = (process.env.AI_IMAGE_PROVIDER || 'pollinations').toLowerCase();
const openAiApiKey = process.env.OPENAI_API_KEY || '';
const openAiImageModel = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';
const huggingFaceApiKey = process.env.HUGGINGFACE_API_KEY || '';
const huggingFaceImageModel = process.env.HUGGINGFACE_IMAGE_MODEL || 'black-forest-labs/FLUX.1-dev';
const huggingFaceImageEndpoint = process.env.HUGGINGFACE_IMAGE_ENDPOINT || '';
const emailSendTimeoutMs = Number(process.env.EMAIL_SEND_TIMEOUT_MS || 180000);
const emailBeginSendTimeoutMs = Number(process.env.EMAIL_BEGIN_SEND_TIMEOUT_MS || 60000);
const imageFetchTimeoutMs = Number(process.env.IMAGE_FETCH_TIMEOUT_MS || 10000);
const aiImageGenerationTimeoutMs = Number(process.env.AI_IMAGE_GENERATION_TIMEOUT_MS || 12000);

const lastEmailErrorByRecipient = new Map<string, string>();

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

const LOCAL_THEMED_IMAGE_PREFIX = 'local-themed://';

const buildLocalThemedImageUrl = (title: string): string => {
  const encoded = encodeURIComponent(title || 'Space Update');
  return `${LOCAL_THEMED_IMAGE_PREFIX}${encoded}`;
};

interface EmailOptions {
  to: string;
  subject: string;
  htmlContent: string;
  attachments?: EmailAttachment[];
}

const wait = async (ms: number): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, ms));
};

const fetchWithTimeout = async (
  url: string,
  init?: Parameters<typeof fetch>[1],
  timeoutMs = imageFetchTimeoutMs
): Promise<Awaited<ReturnType<typeof fetch>>> => {
  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...(init || {}),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutHandle);
  }
};

const normalizeRecipientKey = (email: string): string => email.trim().toLowerCase();

const rememberEmailSendError = (recipient: string, message: string): void => {
  lastEmailErrorByRecipient.set(normalizeRecipientKey(recipient), message);
};

const clearEmailSendError = (recipient: string): void => {
  lastEmailErrorByRecipient.delete(normalizeRecipientKey(recipient));
};

export const consumeLastEmailSendError = (recipient: string): string | undefined => {
  const key = normalizeRecipientKey(recipient);
  const message = lastEmailErrorByRecipient.get(key);
  lastEmailErrorByRecipient.delete(key);
  return message;
};

const TRANSPARENT_PIXEL_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO7Y5mQAAAAASUVORK5CYII=';

type CachedImagePayload = {
  contentType: string;
  contentInBase64: string;
  savedAt: string;
  source?: 'generated' | 'local-generated' | 'placeholder';
};

const isAiTitleImageUrl = (imageUrl: string): boolean => /image\.pollinations\.ai\/prompt\//i.test(imageUrl);

const isLocalThemedImageUrl = (imageUrl?: string): boolean => !!imageUrl && imageUrl.startsWith(LOCAL_THEMED_IMAGE_PREFIX);

const normalizeImageUrlForFetch = (imageUrl: string): string => {
  // Wix image transform URLs (/v1/fill/...) return 403 server-side; strip the transform path
  // and use the raw media URL which is publicly accessible.
  const wixMatch = imageUrl.match(/^(https:\/\/static\.wixstatic\.com\/media\/[^/]+)(\/v1\/|~mv[\d]+)/i);
  if (wixMatch) {
    return wixMatch[1];
  }

  return imageUrl;
};

// Google News logo hosted on lh3.googleusercontent.com — identical across all
// Google News feed items when the real article image is unavailable.
const isGoogleNewsLogoUrl = (imageUrl: string): boolean =>
  imageUrl.startsWith('https://lh3.googleusercontent.com/');

const isRenderableSourceImageUrl = (imageUrl?: string): boolean => {
  if (!imageUrl || !/^https?:\/\//i.test(imageUrl)) {
    return false;
  }

  if (isAiTitleImageUrl(imageUrl) || isLocalThemedImageUrl(imageUrl)) {
    return false;
  }

  if (isGoogleNewsLogoUrl(imageUrl)) {
    return false;
  }

  return true;
};

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
    const source = parsed.source || 'placeholder';
    const ttlHours = source === 'placeholder' ? imageCachePlaceholderTtlHours : imageCacheTtlHours;

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

const getThemeFromTitle = (title: string): { primary: string; accent: string; glow: string; motif: 'rocket' | 'satellite' | 'planet' | 'stars' } => {
  const lower = title.toLowerCase();

  if (/launch|rocket|booster|mission|liftoff/.test(lower)) {
    return { primary: '#1b2a49', accent: '#ff8a3d', glow: '#ffd39a', motif: 'rocket' };
  }

  if (/satellite|orbit|constellation|payload|leo/.test(lower)) {
    return { primary: '#12263a', accent: '#3db4ff', glow: '#95e1ff', motif: 'satellite' };
  }

  if (/moon|mars|planet|lunar|astro/.test(lower)) {
    return { primary: '#1d2330', accent: '#b18cff', glow: '#d8c6ff', motif: 'planet' };
  }

  return { primary: '#142033', accent: '#4fd1c5', glow: '#9ff3ea', motif: 'stars' };
};

const buildLocalThemedSvg = (title: string): string => {
  const seed = crypto.createHash('sha256').update(title.toLowerCase().trim()).digest('hex');
  const theme = getThemeFromTitle(title);

  const n = (index: number, max: number): number => parseInt(seed.slice(index, index + 2), 16) % max;

  const stars = Array.from({ length: 18 }).map((_, i) => {
    const x = n(i * 2, 640);
    const y = n(i * 3 + 1, 360);
    const r = (n(i * 5 + 2, 4) + 1) * 0.7;
    return `<circle cx="${x}" cy="${y}" r="${r.toFixed(1)}" fill="${theme.glow}" opacity="0.55"/>`;
  }).join('');

  const motif = (() => {
    if (theme.motif === 'rocket') {
      return '<g transform="translate(470 170)"><path d="M0 60 L28 12 L56 60 Z" fill="#ffffff" opacity="0.92"/><rect x="22" y="60" width="12" height="34" rx="3" fill="#ffffff" opacity="0.92"/><path d="M16 94 L40 94 L28 124 Z" fill="#ffb37a"/></g>';
    }

    if (theme.motif === 'satellite') {
      return '<g transform="translate(455 170)"><rect x="22" y="26" width="34" height="34" rx="4" fill="#ffffff" opacity="0.9"/><rect x="0" y="30" width="20" height="24" fill="#9fd8ff"/><rect x="58" y="30" width="20" height="24" fill="#9fd8ff"/><line x1="39" y1="26" x2="39" y2="8" stroke="#ffffff" stroke-width="3"/></g>';
    }

    if (theme.motif === 'planet') {
      return '<g transform="translate(485 180)"><circle cx="0" cy="0" r="38" fill="#ffffff" opacity="0.9"/><ellipse cx="0" cy="2" rx="56" ry="14" fill="none" stroke="#ffffff" stroke-width="5" opacity="0.65"/></g>';
    }

    return '<g transform="translate(485 180)"><circle cx="0" cy="0" r="4" fill="#ffffff" opacity="0.95"/><circle cx="34" cy="-20" r="3" fill="#ffffff" opacity="0.9"/><circle cx="-30" cy="24" r="2.8" fill="#ffffff" opacity="0.88"/><circle cx="14" cy="30" r="2.5" fill="#ffffff" opacity="0.88"/></g>';
  })();

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${theme.primary}"/>
      <stop offset="100%" stop-color="#0b1020"/>
    </linearGradient>
    <radialGradient id="orb" cx="20%" cy="20%" r="85%">
      <stop offset="0%" stop-color="${theme.accent}" stop-opacity="0.75"/>
      <stop offset="100%" stop-color="${theme.accent}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="640" height="360" fill="url(#bg)"/>
  <circle cx="120" cy="120" r="170" fill="url(#orb)"/>
  <circle cx="560" cy="30" r="88" fill="${theme.accent}" opacity="0.12"/>
  ${stars}
  ${motif}
</svg>`;
};

const buildLocalThemedAttachment = (title: string, index: number, cid: string): EmailAttachment => {
  const svg = buildLocalThemedSvg(title || 'Space Update');
  return {
    name: `article-${index + 1}.svg`,
    contentType: 'image/svg+xml',
    contentInBase64: Buffer.from(svg).toString('base64'),
    contentId: cid
  };
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
    const response = await fetchWithTimeout('https://api.openai.com/v1/images/generations', {
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
    }, aiImageGenerationTimeoutMs);

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
      const generatedResponse = await fetchWithTimeout(first.url, undefined, imageFetchTimeoutMs);
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

const tryGenerateHuggingFaceTitleImage = async (title: string): Promise<CachedImagePayload | null> => {
  if (!huggingFaceApiKey) {
    return null;
  }

  const prompt = buildImageGenerationPrompt(title);
  const endpoint = huggingFaceImageEndpoint
    || `https://api-inference.huggingface.co/models/${encodeURIComponent(huggingFaceImageModel)}`;

  try {
    const response = await fetchWithTimeout(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${huggingFaceApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        inputs: prompt,
        options: {
          wait_for_model: true
        }
      })
    }, aiImageGenerationTimeoutMs);

    if (!response.ok) {
      return null;
    }

    const contentType = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      return null;
    }

    const imageBuffer = Buffer.from(await response.arrayBuffer());
    if (!imageBuffer.length) {
      return null;
    }

    return {
      contentType,
      contentInBase64: imageBuffer.toString('base64'),
      savedAt: new Date().toISOString(),
      source: 'generated'
    };
  } catch {
    return null;
  }
};

const getContentTypeExtension = (contentType: string): string => {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('jpeg') || contentType.includes('jpg')) return 'jpg';
  if (contentType.includes('gif')) return 'gif';
  if (contentType.includes('webp')) return 'webp';
  if (contentType.includes('svg')) return 'svg';
  return 'img';
};

const loadLogoBase64 = (): string => {
  const logoPath = path.resolve(__dirname, '../../public/oasa-banner.png');
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
): Promise<EmailAttachment | null> => {
  const cacheKey = getImageCacheKey(title);
  const isAiImage = isAiTitleImageUrl(imageUrl);
  const isLocalThemedImage = isLocalThemedImageUrl(imageUrl);

  if (isLocalThemedImage) {
    const cachedPayload = await getCachedImagePayload(cacheKey);
    if (cachedPayload && cachedPayload.source === 'local-generated') {
      return {
        name: `article-${index + 1}.${getContentTypeExtension(cachedPayload.contentType)}`,
        contentType: cachedPayload.contentType,
        contentInBase64: cachedPayload.contentInBase64,
        contentId: cid
      };
    }

    const localAttachment = buildLocalThemedAttachment(title, index, cid);
    await setCachedImagePayload(cacheKey, {
      contentType: localAttachment.contentType,
      contentInBase64: localAttachment.contentInBase64,
      savedAt: new Date().toISOString(),
      source: 'local-generated'
    });

    return localAttachment;
  }

  if (isAiImage) {
    const cachedPayload = await getCachedImagePayload(cacheKey);
    if (cachedPayload) {
      console.log(`Using cached AI title image for article ${index + 1} (${aiImageProvider})`);
      return {
        name: `article-${index + 1}.${getContentTypeExtension(cachedPayload.contentType)}`,
        contentType: cachedPayload.contentType,
        contentInBase64: cachedPayload.contentInBase64,
        contentId: cid
      };
    }
  }

  if (isAiImage && aiImageProvider === 'openai') {
    console.log(`Generating AI title image with OpenAI for article ${index + 1}`);
    const generatedPayload = await tryGenerateOpenAiTitleImage(title);
    if (generatedPayload) {
      await setCachedImagePayload(cacheKey, generatedPayload);
      console.log(`OpenAI AI image generated for article ${index + 1}`);

      return {
        name: `article-${index + 1}.${getContentTypeExtension(generatedPayload.contentType)}`,
        contentType: generatedPayload.contentType,
        contentInBase64: generatedPayload.contentInBase64,
        contentId: cid
      };
    }
  }

  if (isAiImage && aiImageProvider === 'huggingface') {
    console.log(`Generating AI title image with Hugging Face for article ${index + 1}`);
    const generatedPayload = await tryGenerateHuggingFaceTitleImage(title);
    if (generatedPayload) {
      await setCachedImagePayload(cacheKey, generatedPayload);
      console.log(`Hugging Face AI image generated for article ${index + 1}`);

      return {
        name: `article-${index + 1}.${getContentTypeExtension(generatedPayload.contentType)}`,
        contentType: generatedPayload.contentType,
        contentInBase64: generatedPayload.contentInBase64,
        contentId: cid
      };
    }
  }

  try {
    const fetchUrl = normalizeImageUrlForFetch(imageUrl);
    const response = await fetchWithTimeout(fetchUrl, undefined, imageFetchTimeoutMs);
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
    if (!isAiImage && !isLocalThemedImage) {
      // Source image is unavailable — render article text-only rather than showing a broken/placeholder image.
      console.warn(`Source image unavailable for article ${index + 1}: ${imageUrl}`);
      return null;
    }

    if (isAiImage) {
      console.warn(`AI image retrieval failed for article ${index + 1}; using placeholder fallback`);
    }
    try {
      const placeholderUrl = buildTitleReferenceImage(title);
      const placeholderResponse = await fetchWithTimeout(placeholderUrl, undefined, imageFetchTimeoutMs);
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
    rememberEmailSendError(options.to, 'Email client not configured');
    return false;
  }

  clearEmailSendError(options.to);

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

  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      console.log(`Starting email send to ${options.to} (attempt ${attempt}/${maxAttempts})`);

      const poller = await Promise.race([
        emailClient.beginSend(message),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            const timeoutError = new Error(`Email beginSend timed out after ${emailBeginSendTimeoutMs}ms`);
            (timeoutError as Error & { code?: string; statusCode?: number }).code = 'EmailBeginSendTimeout';
            (timeoutError as Error & { code?: string; statusCode?: number }).statusCode = 408;
            reject(timeoutError);
          }, emailBeginSendTimeoutMs);
        })
      ]);

      console.log(`Email send operation accepted for ${options.to}; waiting for provider completion`);

      const result = await Promise.race([
        poller.pollUntilDone(),
        new Promise<never>((_, reject) => {
          setTimeout(() => {
            const timeoutError = new Error(`Email send timed out after ${emailSendTimeoutMs}ms`);
            (timeoutError as Error & { code?: string; statusCode?: number }).code = 'EmailPollTimeout';
            (timeoutError as Error & { code?: string; statusCode?: number }).statusCode = 408;
            reject(timeoutError);
          }, emailSendTimeoutMs);
        })
      ]);

      console.log(`✓ Email sent to ${options.to}, Message ID: ${result.id}`);
      clearEmailSendError(options.to);
      return true;
    } catch (error) {
      const err = error as {
        name?: string;
        message?: string;
        code?: string;
        statusCode?: number;
        details?: {
          [key: string]: unknown;
        };
        response?: {
          parsedBody?: unknown;
          bodyAsText?: string;
        };
      };

      const retryAfterRaw = err?.details && typeof err.details['retry-after'] !== 'undefined'
        ? String(err.details['retry-after'])
        : '';
      const retryAfterFromMessage = err?.message?.match(/after\s+(\d+)\s+seconds?/i);
      const retryAfterSeconds = Number(retryAfterRaw || retryAfterFromMessage?.[1] || '');
      const isRateLimited = err?.statusCode === 429 || err?.code === 'TooManyRequests';
      const isTimeout = err?.code === 'EmailPollTimeout' || err?.code === 'EmailBeginSendTimeout' || err?.statusCode === 408;
      const canRetry = (isRateLimited || isTimeout) && attempt < maxAttempts;

      const failureSummary = `${err?.code || 'EmailSendError'}: ${err?.message || 'Unknown email send failure'}`;
      rememberEmailSendError(options.to, failureSummary);

      console.error('Error sending email:', {
        to: options.to,
        subject: options.subject,
        attempt,
        maxAttempts,
        name: err?.name,
        message: err?.message,
        code: err?.code,
        statusCode: err?.statusCode,
        details: err?.details,
        responseBody: err?.response?.parsedBody || err?.response?.bodyAsText
      });

      if (!canRetry) {
        return false;
      }

      const retryDelayMs = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1000, 65000)
        : (1500 + (attempt * 1200));

      console.warn(`Email provider transient failure (${isRateLimited ? 'rate-limit' : 'timeout'}). Retrying ${options.to} in ${retryDelayMs}ms (attempt ${attempt + 1}/${maxAttempts})`);
      await wait(retryDelayMs);
    }
  }

  return false;
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
  preferencesToken: string,
  frequency?: 'daily' | 'weekly' | 'monthly'
): Promise<boolean> => {
  const editionLabel = frequency === 'daily'
    ? 'Daily Edition'
    : frequency === 'weekly'
      ? 'Weekly Edition'
      : frequency === 'monthly'
        ? 'Monthly Edition'
        : '';
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const unsubscribeUrl = `${appUrl}/api/subscriptions/unsubscribe/${unsubscribeToken}`;
  const preferencesUrl = `${appUrl}/api/subscriptions/preferences/${preferencesToken}`;
  const logoCid = 'oasa-header-logo';
  const logoBase64 = loadLogoBase64();

  const articleWithImageCids: Array<{ article: any; cid?: string; attachment?: EmailAttachment; hasImage: boolean }> = [];
  for (let index = 0; index < articles.length; index += 1) {
    const article = articles[index];
    const rawImageUrl = article.imageUrl;
    const normalizedImageUrl = String(rawImageUrl || '');
    const hasAttachableImage = Boolean(rawImageUrl)
      && isRenderableSourceImageUrl(normalizedImageUrl);

    if (!hasAttachableImage) {
      articleWithImageCids.push({ article, hasImage: false });
      continue;
    }

    const cid = `article-image-${index + 1}`;
    const imageUrl = normalizedImageUrl;

    const attachment = await buildInlineArticleAttachment(
      imageUrl,
      article.title || 'Space update',
      index,
      cid
    );

    if (!attachment) {
      articleWithImageCids.push({ article, hasImage: false });
      continue;
    }

    articleWithImageCids.push({
      article,
      cid,
      attachment,
      hasImage: true
    });
  }

  const attachments: EmailAttachment[] = [
    {
      name: 'oasa-banner.png',
      contentType: 'image/png',
      contentInBase64: logoBase64,
      contentId: logoCid
    },
    ...articleWithImageCids
      .map(item => item.attachment)
      .filter((attachment): attachment is EmailAttachment => Boolean(attachment))
  ];

  const oasaArticles = articleWithImageCids.filter(({ article }) => String(article?.source || '').trim() === OASA_EVENTS_SOURCE);
  const getPublishedTimestamp = (value: unknown): number => {
    const parsed = new Date(String(value || ''));
    const timestamp = parsed.getTime();
    return Number.isFinite(timestamp) ? timestamp : 0;
  };

  const sourceArticles = articleWithImageCids
    .filter(({ article }) => String(article?.source || '').trim() !== OASA_EVENTS_SOURCE)
    .sort((a, b) => getPublishedTimestamp(b.article?.pubDate) - getPublishedTimestamp(a.article?.pubDate));

  const normalizeOasaDescription = (value: unknown): string => {
    const raw = String(value || '').trim();
    return raw
      .replace(/^\s*summary\s*:\s*/i, '')
      .replace(/^\s*key\s*point\s*:\s*/i, '')
      .replace(/^\s*\d+\s+days?\s+to\s+the\s+event\s*/i, '')
      .replace(/\s*more\s+info\s*$/i, '')
      .trim();
  };

  const renderInlineArticleBlocks = (items: Array<{ article: any; cid?: string; hasImage: boolean }>, options?: { preserveOasaText?: boolean }): string => items.map(({ article, cid, hasImage }) => {
    const description = options?.preserveOasaText && String(article?.source || '').trim() === OASA_EVENTS_SOURCE
      ? normalizeOasaDescription(article.description)
      : article.description;
    const titleClass = hasImage ? 'article-title-box' : 'article-title-box text-only';
    return `
          <div class="article">
            <div class="${titleClass}"><h3>${article.title}</h3></div>
            ${hasImage && cid ? `<img src="cid:${cid}" alt="${article.title}">` : ''}
            <p>${description}</p>
            <p><a href="${article.link}" class="read-more">Read more →</a></p>
            <p style="font-size: 12px; color: #666;">Source: ${article.source} | ${new Date(article.pubDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        `;
  }).join('');

  const renderExternalArticleBlocks = (items: any[], options?: { preserveOasaText?: boolean }): string => items.map((article) => {
    const description = options?.preserveOasaText && String(article?.source || '').trim() === OASA_EVENTS_SOURCE
      ? normalizeOasaDescription(article.description)
      : article.description;
    const hasExternalImage = isRenderableSourceImageUrl(article?.imageUrl);
    const titleClass = hasExternalImage ? 'article-title-box' : 'article-title-box text-only';

    return `
          <div class="article">
            <div class="${titleClass}"><h3>${article.title}</h3></div>
            ${hasExternalImage ? `<img src="${article.imageUrl}" alt="${article.title}">` : ''}
            <p>${description}</p>
            <p><a href="${article.link}" class="read-more">Read more →</a></p>
            <p style="font-size: 12px; color: #666;">Source: ${article.source} | ${new Date(article.pubDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</p>
          </div>
        `;
  }).join('');

  const renderSections = (oasaMarkup: string, sourcesMarkup: string): string => `
        <div class="section">
          <h2>Space News</h2>
          ${sourcesMarkup || '<p>No additional source updates available for this issue.</p>'}
        </div>
        <div class="section">
          <h2>Updates from OASA</h2>
          ${oasaMarkup || '<p>No OASA event updates available for this issue.</p>'}
        </div>
      `;

  const renderNewsletterHtml = (sectionMarkup: string): string => `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif; line-height: 1.6; color: #1f2937; background-color: #f3f4f6; }
        .container { max-width: 700px; margin: 0 auto; background-color: white; padding: 20px; }
        .header { background-color: #ffffff; color: #111827; padding: 24px 20px; text-align: center; border-bottom: 1px solid #e5e7eb; }
        .header h1 { margin: 8px 0 10px; font-size: 30px; font-weight: 700; letter-spacing: -0.3px; }
        .header p { margin: 0; font-size: 14px; color: #6b7280; }
        .section { margin: 22px 0 28px; }
        .section h2 { margin: 0 0 14px; color: #111827; font-size: 20px; font-weight: 700; padding-bottom: 10px; border-bottom: 2px solid #3b82f6; }
        .header-logo { max-width: 100%; width: 100%; height: auto; display: block; border-radius: 0; }
        .article { margin: 16px 0; padding: 16px; border: 1px solid #e5e7eb; border-radius: 8px; background-color: #f9fafb; }
        .article h3 { margin-top: 0; }
        .article-title-box { background: #eef4ff; border: 1px solid #d6e4ff; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; }
        .article-title-box h3 { margin: 0; font-size: 19px; line-height: 1.3; color: #111827; }
        .article-title-box.text-only { padding: 6px 10px; background: #f3f4f6; border-color: #e5e7eb; }
        .article-title-box.text-only h3 { font-size: 16px; }
        .article img { max-width: 100%; height: auto; margin: 10px 0; border-radius: 6px; }
        .article p { color: #4b5563; }
        .read-more { color: #2563eb; text-decoration: none; font-weight: 600; }
        .footer { margin-top: 30px; padding: 20px; border-top: 1px solid #e5e7eb; background: #f9fafb; font-size: 12px; color: #6b7280; text-align: center; }
        .footer a { color: #2563eb; text-decoration: none; }
        .disclaimer { margin-top: 16px; font-size: 10px; line-height: 1.5; color: #9ca3af; text-align: left; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header" style="background-color:#ffffff;color:#111827;padding:24px 20px;text-align:center;border-bottom:1px solid #e5e7eb;">
          <img src="cid:${logoCid}" alt="OASA NewSpace Newsletter" class="header-logo">
          <h1>OASA NewSpace Newsletter</h1>
          <p>${editionLabel ? `<strong>${editionLabel}</strong> · ` : ''}Latest updates from space exploration and the low-altitude economy</p>
        </div>
        
        ${sectionMarkup}
        
        <div class="footer">
          <p>You're receiving this email because you subscribed to NewSpace Newsletter.</p>
          <p><a href="${preferencesUrl}">Manage preferences</a> | <a href="${unsubscribeUrl}">Unsubscribe</a></p>
          <p class="disclaimer">This communication (and any attachments) is directed in confidence to the addressee(s) listed above, and may not otherwise be distributed, copied or used. The contents of this communication may also be subject to privilege, and all rights to that privilege are expressly claimed and not waived. If you have received this communication in error, please notify us by reply e-mail or by telephone and delete this communication (and any attachments) without making a copy. Before opening or using attachments, you should check them for viruses and defects. We do not accept liability in connection with computer virus, data corruption, delay, interruption, unauthorized access or unauthorized amendment.  本電郵(連同任何附加檔案)只供指定收件人閱讀，內容可能包括只有指定收件人才有權接收的資料。如你並非本電郵的原定收件人，請勿使用、保留、披露、複製、列印、轉發或發放本電郵。如本電郵誤發給你，請從電腦系統刪除本電郵所有複本(包括附加檔案)，並立即通知發件人。 創星匯並不宣稱或保證本電郵不含軟件病毒，也不宣稱或保證本電郵所載資料準確、真實和完整。 如本電郵的指定收件人或其他人因本電郵含有軟件病毒或因本電郵所載資料不準確、不真實或不完整而蒙受損害或損失，創星匯概不承擔法律責任。</p>
        </div>
      </div>
    </body>
    </html>
  `;

  const htmlContent = renderNewsletterHtml(
    renderSections(
      renderInlineArticleBlocks(oasaArticles, { preserveOasaText: true }),
      renderInlineArticleBlocks(sourceArticles)
    )
  );

  const sentWithInlineImages = await sendEmail({
    to: email,
    subject: `OASA NewSpace Newsletter${editionLabel ? ` - ${editionLabel}` : ''} - ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    htmlContent,
    attachments
  });

  if (sentWithInlineImages) {
    return true;
  }

  // If inline/cached attachments fail provider validation, retry with external image URLs.
  console.warn(`Retrying newsletter send to ${email} without inline article image attachments`);

  const fallbackHtmlContent = renderNewsletterHtml(
    renderSections(
      renderExternalArticleBlocks(articles.filter((article) => String(article?.source || '').trim() === OASA_EVENTS_SOURCE), { preserveOasaText: true }),
      renderExternalArticleBlocks(
        articles
          .filter((article) => String(article?.source || '').trim() !== OASA_EVENTS_SOURCE)
          .sort((a, b) => getPublishedTimestamp(b?.pubDate) - getPublishedTimestamp(a?.pubDate))
      )
    )
  );
  const minimalAttachments: EmailAttachment[] = [
    {
      name: 'oasa-banner.png',
      contentType: 'image/png',
      contentInBase64: logoBase64,
      contentId: logoCid
    }
  ];

  return await sendEmail({
    to: email,
    subject: `OASA NewSpace Newsletter${editionLabel ? ` - ${editionLabel}` : ''} - ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
    htmlContent: fallbackHtmlContent,
    attachments: minimalAttachments
  });
};
