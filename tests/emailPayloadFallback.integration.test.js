const ORIGINAL_ENV = process.env;

const makeArticle = (overrides = {}) => ({
  title: 'Test Space Update',
  description: 'A short test description',
  source: 'NASA',
  link: 'https://example.com/article',
  pubDate: '2026-05-13T00:00:00.000Z',
  imageUrl: '',
  ...overrides
});

const loadEmailServiceWithMockClient = (envOverrides = {}) => {
  const sentMessages = [];

  jest.resetModules();
  process.env = {
    ...ORIGINAL_ENV,
    AZURE_COMMUNICATION_CONNECTION_STRING: 'endpoint=https://example.communication.azure.com/;accesskey=fake',
    SENDER_EMAIL: 'noreply@example.com',
    APP_URL: 'https://newspace-newsletter-api.azurewebsites.net',
    EMAIL_BEGIN_SEND_TIMEOUT_MS: '20',
    EMAIL_SEND_TIMEOUT_MS: '20',
    ...envOverrides
  };

  jest.doMock('@azure/communication-email', () => ({
    EmailClient: class MockEmailClient {
      beginSend(message) {
        sentMessages.push(message);
        return Promise.resolve({
          pollUntilDone: () => Promise.resolve({ id: 'mock-id' })
        });
      }
    }
  }));

  // Require after env + module mock so module-level config is captured correctly.
  const emailService = require('../dist/services/emailService.js');
  return { emailService, sentMessages };
};

describe('sendNewsletterEmail payload fallback behavior', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  test('forces external-only send when EMAIL_FORCE_EXTERNAL_IMAGES=true', async () => {
    const { emailService, sentMessages } = loadEmailServiceWithMockClient({
      EMAIL_FORCE_EXTERNAL_IMAGES: 'true',
      EMAIL_PAYLOAD_SOFT_LIMIT_BYTES: '9500000'
    });

    const ok = await emailService.sendNewsletterEmail(
      'recipient@example.com',
      [makeArticle()],
      'unsubscribe-token',
      'preferences-token',
      'daily'
    );

    expect(ok).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].attachments).toEqual([]);
    expect(sentMessages[0].content.html).toContain('https://newspace-newsletter-api.azurewebsites.net/oasa-banner.png');
  });

  test('falls back to zero-attachment variant when payload soft limit blocks inline variants', async () => {
    const { emailService, sentMessages } = loadEmailServiceWithMockClient({
      EMAIL_FORCE_EXTERNAL_IMAGES: 'false',
      EMAIL_PAYLOAD_SOFT_LIMIT_BYTES: '1'
    });

    const ok = await emailService.sendNewsletterEmail(
      'recipient@example.com',
      [makeArticle()],
      'unsubscribe-token',
      'preferences-token',
      'daily'
    );

    expect(ok).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0].attachments).toEqual([]);
    expect(sentMessages[0].content.html).toContain('https://newspace-newsletter-api.azurewebsites.net/oasa-banner.png');
  });

  test('does not include bootcamp items in the OASA updates section', async () => {
    const { emailService, sentMessages } = loadEmailServiceWithMockClient({
      EMAIL_FORCE_EXTERNAL_IMAGES: 'true',
      EMAIL_PAYLOAD_SOFT_LIMIT_BYTES: '9500000'
    });

    const ok = await emailService.sendNewsletterEmail(
      'recipient@example.com',
      [
        makeArticle({
          source: 'OASA Events',
          title: 'OASA Bootcamp',
          description: 'A bootcamp event for members'
        })
      ],
      'unsubscribe-token',
      'preferences-token',
      'daily'
    );

    expect(ok).toBe(true);
    expect(sentMessages).toHaveLength(1);
    const html = sentMessages[0].content.html;
    expect(html).not.toContain('OASA Bootcamp');
    expect(html).not.toContain('bootcamp');
  });
});
