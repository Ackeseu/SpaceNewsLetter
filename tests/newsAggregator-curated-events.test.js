require('ts-node/register/transpile-only');
const assert = require('assert');
const { getCuratedSeaEventEntries, parseSeaEventCardsFromHtml } = require('../src/services/newsAggregator');

const entries = getCuratedSeaEventEntries();
assert.ok(entries.length > 0, 'expected curated SEA event entries');

const spaceBizEvent = entries.find((entry) => entry.link.includes('spacebiz-dialogues-august-2026'));
assert.ok(spaceBizEvent, 'expected the SpaceBiz August event entry');
assert.ok(spaceBizEvent.title.includes('SpaceBiz Dialogues'), 'expected the curated title to include SpaceBiz Dialogues');
assert.ok(spaceBizEvent.imageUrl.includes('wixstatic.com'), 'expected the curated entry to include the provided image URL');

// Use a dynamically computed future date so the "upcoming event" filter never ages this fixture out.
const futureDate = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
const futureDateKey = futureDate.toISOString().slice(0, 10);
const futureDay = String(futureDate.getUTCDate()).padStart(2, '0');
const futureMonth = futureDate.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });

const sampleHtml = `
  <div class="events-list">
    <div class="event-card" data-event-date="${futureDateKey}">
      <div class="event-date-box"><div class="day">${futureDay}</div><div class="month">${futureMonth}</div></div>
      <div class="event-card-thumb"><img src="images/uploads/1788484958537-events-sept-2026-kv-v2.png" alt="SpaceBiz Dialogues - How Might Hong Kong Ground Insurance and Space? event banner"></div>
      <div class="event-info">
        <div class="event-title">SpaceBiz Dialogues - How Might Hong Kong Ground Insurance and Space?</div>
        <div class="event-meta"><span>5:30PM - 7:30PM</span><span>Hong Kong</span></div>
        <p>Space may seem distant. The risks are not.</p>
        <a href="https://www.oasahk.org/event-details/spacebiz-dialogues-how-might-hong-kong-ground-insurance-and-space" class="btn btn-navy">View Event</a>
      </div>
    </div>
    <div class="event-card" data-event-date="${futureDateKey}">
      <div class="event-date-box"><div class="day">${futureDay}</div><div class="month">${futureMonth}</div></div>
      <div class="event-card-thumb"><img src="images/uploads/cima-seminar.png" alt="CIMA Space Economy Seminar banner"></div>
      <div class="event-info">
        <div class="event-title">[Collaborative Event] CIMA Space Economy Seminar</div>
        <div class="event-meta"><span>3:00PM - 5:00PM</span><span>Hong Kong</span></div>
        <p>Registration via the external form.</p>
        <a href="https://forms.cloud.microsoft/r/una6t7hMnu" class="btn btn-navy">Register</a>
      </div>
    </div>
    <div class="event-card" data-event-date="${futureDateKey}">
      <div class="event-date-box"><div class="day">${futureDay}</div><div class="month">${futureMonth}</div></div>
      <div class="event-info">
        <div class="event-title">[Save the Date] SEA Annual Dinner 2026</div>
        <div class="event-meta"><span>7:00PM</span><span>Hong Kong</span></div>
        <p>Details to follow.</p>
      </div>
    </div>
  </div>
`;

const parsed = parseSeaEventCardsFromHtml(sampleHtml);
assert.ok(parsed.length === 3, `expected three parsed event cards, got ${parsed.length}`);
assert.ok(parsed[0].title.includes('SpaceBiz Dialogues'), 'expected parsed title to include SpaceBiz Dialogues');
assert.ok(parsed[0].link.includes('event-details'), 'expected parsed link to be resolved from the event card');
assert.ok(parsed[0].imageUrl.includes('seahk.org'), 'expected parsed image URL to resolve against the SEA domain');
const registrationCard = parsed.find((entry) => entry.title.includes('CIMA Space Economy Seminar'));
assert.ok(registrationCard, 'expected the registration-form event card to be kept');
assert.ok(registrationCard.link.includes('forms.cloud.microsoft'), 'expected the registration link to be used when no event-details link exists');
const linklessCard = parsed.find((entry) => entry.title.includes('SEA Annual Dinner'));
assert.ok(linklessCard, 'expected the event card without any link to be kept');
assert.ok(linklessCard.link.includes('seahk.org/events.html#'), 'expected the linkless card to fall back to a unique SEA events page anchor');

console.log('curated sea event test passed');
