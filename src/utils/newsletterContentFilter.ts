export interface NewsletterContentMetadata {
  source?: string;
  category?: string[];
  region?: string;
  link?: string;
}

const SPACE_TECH_KEYWORDS = [
  'satellite', 'payload', 'launch vehicle', 'rocket engine', 'propulsion',
  'avionics', 'spacecraft', 'orbital', 'navigation', 'remote sensing',
  'communications satellite', 'earth observation', 'space station',
  'guidance system', 'robotics', 'autonomous', 'aerospace technology'
];

const NEWSPACE_KEYWORDS = [
  'newspace', 'space startup', 'space economy', 'low-altitude economy',
  'commercial space', 'satellite startup', 'earth observation', 'smallsat',
  'microsatellite', 'space commercialization', 'space venture'
];

const SPACE_CORE_KEYWORDS = [
  'space', 'satellite', 'orbit', 'orbital', 'rocket', 'launch', 'aerospace',
  'payload', 'constellation', 'earth observation', 'remote sensing', 'navigation'
];

const CRIME_WAR_EXCLUSION_KEYWORDS = [
  'murder', 'homicide', 'robbery', 'theft', 'burglary', 'assault', 'kidnap',
  'trafficking', 'drug bust', 'gang', 'cartel', 'criminal', 'crime',
  'war crime', 'genocide', 'atrocity', 'massacre', 'bombing', 'terrorist',
  'terrorism', 'insurgent', 'insurgency', 'militia', 'war zone', 'warzone',
  'battlefield', 'ceasefire', 'airstrike', 'air strike', 'shelling',
  'casualt', 'fatalities', 'civilian deaths', 'war in', 'military conflict',
  'armed conflict', 'hostage', 'ransom', 'smuggling', 'fraud conviction',
  'indicted', 'arrested for', 'sentenced to'
];

const OFF_TOPIC_NONSPACE_EXCLUSION_KEYWORDS = [
  'yasukuni shrine',
  'tokyo trial',
  'nanjing massacre',
  'comfort women',
  'wartime atrocities',
  'war memory',
  'inverted narrative'
];

const hasAnyKeyword = (text: string, keywords: string[]): boolean => {
  return keywords.some((keyword) => text.includes(keyword));
};

export const passesCrimeWarFilter = (text: string): boolean => {
  return !hasAnyKeyword(text, CRIME_WAR_EXCLUSION_KEYWORDS);
};

const hasStrongSpaceSignal = (
  text: string,
  metadata?: NewsletterContentMetadata
): boolean => {
  const source = (metadata?.source || '').toLowerCase();
  const category = (metadata?.category || []).map((value) => value.toLowerCase());
  const link = (metadata?.link || '').toLowerCase();

  return (
    hasAnyKeyword(text, SPACE_CORE_KEYWORDS)
    || hasAnyKeyword(text, SPACE_TECH_KEYWORDS)
    || hasAnyKeyword(text, NEWSPACE_KEYWORDS)
    || source.includes('space')
    || source.includes('satellite')
    || source.includes('aerospace')
    || category.some((value) => (
      value.includes('space')
      || value.includes('satellite')
      || value.includes('aerospace')
      || value.includes('newspace')
      || value.includes('launch')
      || value.includes('orbit')
    ))
    || link.includes('spacenews')
    || link.includes('nasa.gov')
    || link.includes('esa.int')
    || link.includes('space.com')
    || link.includes('spaceflightnow.com')
  );
};

export const passesTopicalRelevanceFilter = (
  title: string,
  description: string,
  metadata?: NewsletterContentMetadata
): boolean => {
  const text = `${title} ${description}`.toLowerCase();
  const hasOffTopicSignal = hasAnyKeyword(text, OFF_TOPIC_NONSPACE_EXCLUSION_KEYWORDS);

  if (!hasOffTopicSignal) {
    return true;
  }

  return hasStrongSpaceSignal(text);
};

export const passesNewsletterContentFilter = (
  title: string,
  description: string,
  metadata?: NewsletterContentMetadata
): boolean => {
  const text = `${title} ${description}`.toLowerCase();
  return passesCrimeWarFilter(text) && passesTopicalRelevanceFilter(title, description, metadata);
};