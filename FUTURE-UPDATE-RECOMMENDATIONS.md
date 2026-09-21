# Future Update Recommendations

This document records practical improvements for the newsletter as the subscriber list grows beyond the current roughly 130 recipients.

## Priority 1: Make Sends Resumable

The current sender processes recipients sequentially in one request. This is reliable at the current size, but a long run can approach platform request timeouts and is difficult to resume safely after interruption.

Recommended design:

- Create a `newsletter_send_runs` table with status, frequency, list filter, totals, and timestamps.
- Create a `newsletter_send_run_recipients` table with recipient status, attempts, provider message ID, and last error.
- Process recipients in batches of 25-50 through a background worker or Azure Queue-triggered Function.
- Make each recipient transition idempotent so a retry cannot create duplicate delivery records for the same run.
- Expose progress and failed-recipient retry controls in the admin UI.

Acceptance criteria:

- A failed run can resume from the last unfinished recipient.
- A retry targets only failed or unattempted recipients.
- The admin view shows sent, failed, pending, and skipped totals.

## Priority 2: Cache Per-Edition Work

Each recipient currently performs article selection and image preparation during the send loop. Cache the rendered newsletter and image attachments by a preference fingerprint containing frequency, topics, regions, and edition/article set.

Acceptance criteria:

- Identical preference groups reuse the same rendered content and attachments.
- Subscriber-specific unsubscribe and preference URLs remain personalized.
- Payload size is checked before provider submission.

## Priority 3: Improve SEA Event Synchronization

Keep `https://seahk.org/events.html#upcoming` as the source of truth for upcoming SEA events. Continue accepting external registration links, including `forms.gle`, and retain the current-date filter.

Recommended additions:

- Add fixtures containing every currently published upcoming event shape.
- Alert when the live page has upcoming events but parsing returns zero.
- Record the last successful scrape time and parsed event count in monitor status.
- Keep stale event cleanup limited to SEA event source records.

## Priority 4: Harden Subscriber Operations

- Add a unique normalized-email strategy at the database boundary, not only in importer code.
- Provide an explicit admin action to activate or deactivate a named list with confirmation and audit logging.
- Add list-level counts for total, verified, active, eligible, and last delivery.
- Preserve unsubscribe state when re-importing a workbook.
- Keep import workbooks in persistent storage outside the deploy directory.

## Priority 5: Operational Guardrails

- Keep manual scheduled sends disabled except during approved campaigns.
- Require a dry-run recipient count before every targeted send.
- Add a maximum recipient limit to manual send requests.
- Alert on unusual failure rates, provider throttling, and payload fallback usage.
- Keep delivery logs long enough to compare weekly campaigns and identify domain-specific failures.

## Suggested Sequence

1. Add send-run and recipient-run persistence.
2. Move delivery into Azure Queue-triggered batches.
3. Cache rendered editions and image attachments.
4. Add admin progress, retry, and list activation controls.
5. Add SEA scrape monitoring and broader parser fixtures.