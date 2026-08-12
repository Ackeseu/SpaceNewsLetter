require('ts-node/register/transpile-only');
const assert = require('assert');
const { getCuratedSeaEventEntries } = require('../src/services/newsAggregator');

const entries = getCuratedSeaEventEntries();
assert.ok(entries.length > 0, 'expected curated SEA event entries');

const spaceBizEvent = entries.find((entry) => entry.link.includes('spacebiz-dialogues-august-2026'));
assert.ok(spaceBizEvent, 'expected the SpaceBiz August event entry');
assert.ok(spaceBizEvent.title.includes('SpaceBiz Dialogues'), 'expected the curated title to include SpaceBiz Dialogues');
assert.ok(spaceBizEvent.imageUrl.includes('wixstatic.com'), 'expected the curated entry to include the provided image URL');

console.log('curated sea event test passed');
