import fs from 'fs';
import path from 'path';

export interface NewsletterPriorityBaseSettings {
  seaEvent: number;
  hkNewspaceBusiness: number;
  hkNewspaceOrTech: number;
  asiaBusiness: number;
  globalBusiness: number;
  globalTechnology: number;
  remainingSpace: number;
}

export interface NewsletterSessionPlanSettings {
  sea: number;
  hongKong: number;
  china: number;
  world: number;
}

export interface NewsletterPrioritySettings {
  priorityBase: NewsletterPriorityBaseSettings;
  sessionPlan: NewsletterSessionPlanSettings;
}

const SETTINGS_FILE_PATH = path.resolve(process.cwd(), 'src/config/newsletterPrioritySettings.json');

const DEFAULT_NEWSLETTER_PRIORITY_SETTINGS: NewsletterPrioritySettings = {
  priorityBase: {
    seaEvent: 500,
    hkNewspaceBusiness: 470,
    hkNewspaceOrTech: 440,
    asiaBusiness: 400,
    globalBusiness: 400,
    globalTechnology: 380,
    remainingSpace: 100
  },
  sessionPlan: {
    sea: 2,
    hongKong: 3,
    china: 1,
    world: 4
  }
};

const normalizeInteger = (
  value: unknown,
  fallback: number,
  min: number,
  max: number
): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  const rounded = Math.floor(parsed);
  if (rounded < min) {
    return min;
  }

  if (rounded > max) {
    return max;
  }

  return rounded;
};

const normalizePrioritySettings = (value: unknown): NewsletterPrioritySettings => {
  const raw = value && typeof value === 'object' ? value as Partial<NewsletterPrioritySettings> : {};
  const rawPriority = raw.priorityBase && typeof raw.priorityBase === 'object'
    ? raw.priorityBase as Partial<NewsletterPriorityBaseSettings>
    : {};
  const rawSessionPlan = raw.sessionPlan && typeof raw.sessionPlan === 'object'
    ? raw.sessionPlan as Partial<NewsletterSessionPlanSettings>
    : {};
  const rawPriorityLegacy = rawPriority as Record<string, unknown>;
  const rawSessionLegacy = rawSessionPlan as Record<string, unknown>;

  return {
    priorityBase: {
      // Backward compatible: accept legacy `oasaEvent` from previously saved settings.
      seaEvent: normalizeInteger(rawPriority.seaEvent ?? rawPriorityLegacy.oasaEvent, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase.seaEvent, 0, 1000),
      hkNewspaceBusiness: normalizeInteger(rawPriority.hkNewspaceBusiness, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase.hkNewspaceBusiness, 0, 1000),
      hkNewspaceOrTech: normalizeInteger(rawPriority.hkNewspaceOrTech, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase.hkNewspaceOrTech, 0, 1000),
      asiaBusiness: normalizeInteger(rawPriority.asiaBusiness, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase.asiaBusiness, 0, 1000),
      globalBusiness: normalizeInteger(rawPriority.globalBusiness, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase.globalBusiness, 0, 1000),
      globalTechnology: normalizeInteger(rawPriority.globalTechnology, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase.globalTechnology, 0, 1000),
      remainingSpace: normalizeInteger(rawPriority.remainingSpace, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase.remainingSpace, 0, 1000)
    },
    sessionPlan: {
      // Backward compatible: accept legacy `oasa` from previously saved settings.
      sea: normalizeInteger(rawSessionPlan.sea ?? rawSessionLegacy.oasa, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.sessionPlan.sea, 0, 20),
      hongKong: normalizeInteger(rawSessionPlan.hongKong, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.sessionPlan.hongKong, 0, 20),
      china: normalizeInteger(rawSessionPlan.china, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.sessionPlan.china, 0, 20),
      world: normalizeInteger(rawSessionPlan.world, DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.sessionPlan.world, 0, 20)
    }
  };
};

let cachedSettings: NewsletterPrioritySettings | null = null;

const writeSettingsToDisk = (settings: NewsletterPrioritySettings): void => {
  const dirPath = path.dirname(SETTINGS_FILE_PATH);
  fs.mkdirSync(dirPath, { recursive: true });
  fs.writeFileSync(SETTINGS_FILE_PATH, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
};

const loadSettingsFromDisk = (): NewsletterPrioritySettings => {
  try {
    if (!fs.existsSync(SETTINGS_FILE_PATH)) {
      writeSettingsToDisk(DEFAULT_NEWSLETTER_PRIORITY_SETTINGS);
      return { ...DEFAULT_NEWSLETTER_PRIORITY_SETTINGS, priorityBase: { ...DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase }, sessionPlan: { ...DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.sessionPlan } };
    }

    const rawText = fs.readFileSync(SETTINGS_FILE_PATH, 'utf8');
    const parsed = JSON.parse(rawText);
    const normalized = normalizePrioritySettings(parsed);
    writeSettingsToDisk(normalized);
    return normalized;
  } catch (error) {
    console.error('Failed to load newsletter priority settings, using defaults:', error);
    return { ...DEFAULT_NEWSLETTER_PRIORITY_SETTINGS, priorityBase: { ...DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.priorityBase }, sessionPlan: { ...DEFAULT_NEWSLETTER_PRIORITY_SETTINGS.sessionPlan } };
  }
};

const cloneSettings = (settings: NewsletterPrioritySettings): NewsletterPrioritySettings => ({
  priorityBase: { ...settings.priorityBase },
  sessionPlan: { ...settings.sessionPlan }
});

export const getNewsletterPrioritySettings = (): NewsletterPrioritySettings => {
  if (!cachedSettings) {
    cachedSettings = loadSettingsFromDisk();
  }

  return cloneSettings(cachedSettings);
};

export const saveNewsletterPrioritySettings = (nextSettings: unknown): NewsletterPrioritySettings => {
  const normalized = normalizePrioritySettings(nextSettings);
  cachedSettings = normalized;
  writeSettingsToDisk(normalized);
  return cloneSettings(normalized);
};
