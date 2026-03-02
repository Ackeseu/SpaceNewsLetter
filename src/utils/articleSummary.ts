const normalizeText = (value: string): string => value.replace(/\s+/g, ' ').trim();

const stripHtml = (value: string): string => value.replace(/<[^>]*>/g, ' ');

const cleanSummarySourceText = (value: string): string => {
  const cleaned = normalizeText(
    stripHtml(value)
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;|&apos;/gi, "'")
      .replace(/read\s+more\.?/gi, '')
      .replace(/click\s+here\.?/gi, '')
  );

  return cleaned
    .replace(/^\s*(summary\s*:\s*)+/i, '')
    .replace(/\s*(?:\.|!|\?)?\s*(key\s*point\s*:\s*)+/gi, '. ')
    .replace(/\s*\.\s*\./g, '.')
    .trim();
};

const trimSentencePunctuation = (value: string): string => value.replace(/[\s.!?]+$/, '').trim();

const trimToWordBoundary = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  const sliced = value.slice(0, maxLength - 3).trim();
  const lastSpace = sliced.lastIndexOf(' ');
  const cleanSlice = lastSpace > 40 ? sliced.slice(0, lastSpace).trim() : sliced;
  return `${cleanSlice}...`;
};

const capLength = (value: string, maxLength: number): string => {
  if (value.length <= maxLength) {
    return value;
  }

  return trimToWordBoundary(value, maxLength);
};

export const buildArticleSummary = (title: string, rawDescription: string): string => {
  const cleaned = cleanSummarySourceText(rawDescription);
  if (!cleaned) {
    return `Summary: ${capLength(title, 320)}`;
  }

  const sentences = cleaned
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => normalizeText(sentence))
    .filter((sentence) => sentence.length >= 30);

  const primary = trimSentencePunctuation(sentences[0] || cleaned);
  const secondary = trimSentencePunctuation(sentences[1] || '');

  let summary = `Summary: ${primary}.`;
  if (secondary) {
    summary += ` Key point: ${secondary}.`;
  }

  return capLength(summary, 420);
};

export const trimTextForEmail = (value: string, maxLength: number): string => {
  return capLength(normalizeText(value), maxLength);
};
