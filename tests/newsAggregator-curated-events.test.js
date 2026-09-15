require('ts-node/register/transpile-only');
const assert = require('assert');
const { getCuratedSeaEventEntries, parseSeaEventCardsFromHtml } = require('../src/services/newsAggregator');

const entries = getCuratedSeaEventEntries();
assert.ok(entries.length > 0, 'expected curated SEA event entries');

const spaceBizEvent = entries.find((entry) => entry.link.includes('spacebiz-dialogues-august-2026'));
assert.ok(spaceBizEvent, 'expected the SpaceBiz August event entry');
assert.ok(spaceBizEvent.title.includes('SpaceBiz Dialogues'), 'expected the curated title to include SpaceBiz Dialogues');
assert.ok(spaceBizEvent.imageUrl.includes('wixstatic.com'), 'expected the curated entry to include the provided image URL');

const sampleHtml = `
  <div class="events-list">
    <div class="event-card" data-event-date="2026-09-22">
      <div class="event-date-box"><div class="day">22</div><div class="month">Sep</div></div>
      <div class="event-card-thumb"><img src="images/uploads/1788484958537-events-sept-2026-kv-v2.png" alt="SpaceBiz Dialogues (September 2026) - How Might Hong Kong Ground Insurance and Space? event banner"></div>
      <div class="event-info">
        <div class="event-title">SpaceBiz Dialogues (September 2026) - How Might Hong Kong Ground Insurance and Space?</div>
        <div class="event-meta"><span>5:30PM - 7:30PM</span><span>Hong Kong</span></div>
        <p>Space may seem distant. The risks are not.</p>
        <a href="https://www.oasahk.org/event-details/spacebiz-dialogues-september-2026-how-might-hong-kong-ground-insurance-and-space" class="btn btn-navy">View Event</a>
      </div>
    </div>
  </div>
`;

const parsed = parseSeaEventCardsFromHtml(sampleHtml);
assert.ok(parsed.length === 1, 'expected one parsed event card');
assert.ok(parsed[0].title.includes('SpaceBiz Dialogues'), 'expected parsed title to include SpaceBiz Dialogues');
assert.ok(parsed[0].link.includes('event-details'), 'expected parsed link to be resolved from the event card');
assert.ok(parsed[0].imageUrl.includes('seahk.org'), 'expected parsed image URL to resolve against the SEA domain');

console.log('curated sea event test passed');
