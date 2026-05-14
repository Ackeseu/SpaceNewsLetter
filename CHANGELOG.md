# Changelog

All notable changes to the NewSpace Newsletter project will be documented in this file.

## [Unreleased]

### Fixed
- **OASA Banner Email Rendering** - Fixed issue where OASA logo was not rendering in newsletter emails or appeared as external URL instead of embedded image
  - Optimized `public/oasa-banner.png` from 886KB to 154KB (82.6% reduction) via image resizing (2360×1328px → 700×394px)
  - Identified and corrected `EMAIL_PAYLOAD_SOFT_LIMIT_BYTES` configuration from 3MB to 9.5MB (just below Azure's 10MB hard limit)
  - Configuration change allows inline image attachments to be properly embedded in newsletters with base64 encoding
  - Fallback mechanism now works correctly: full-fidelity HTML with inline images → text-only variant → external-only HTML
  - **Testing**: Verified via test email to napolex@msn.com after deployment

### Configuration Changes
  - This setting controls when the email service falls back from inline to external images
  - Recommended value is 9.5MB (default), leaving 0.5MB safety margin below ACS 10MB hard limit
  - Set via: `az webapp config appsettings set ... --settings EMAIL_PAYLOAD_SOFT_LIMIT_BYTES=9500000`

### Asset Optimization
- `EMAIL_FORCE_EXTERNAL_IMAGES`: Disabled (set to false) in Azure App Service settings
  - This emergency override was forcing ALL emails to use external images regardless of payload
  - Had been set as temporary workaround when soft limit was too restrictive
  - Disabling allows the soft limit logic to work properly for inline attachment decisions
  - Set via: `az webapp config appsettings set ... --settings EMAIL_FORCE_EXTERNAL_IMAGES=false`

### Root Cause Analysis
The OASA logo issue was caused by **cascading restrictive configuration settings**:
1. **`EMAIL_PAYLOAD_SOFT_LIMIT_BYTES=3MB`** (too restrictive) - forced fallback even for small emails
2. **`EMAIL_FORCE_EXTERNAL_IMAGES=true`** (emergency override) - bypassed soft limit logic entirely
3. Combined effect: ALL newsletters used external image URLs, regardless of actual payload size
4. **Solution required fixing BOTH settings**, not just the soft limit

### Asset Optimization
  - Original: 886KB (2360×1328px)
  - Optimized: 154KB (700×394px) - maintains aspect ratio
  - Optimization method: macOS `sips` tool (`sips -Z 700 public/oasa-banner.png`)
  - Rationale: Email container max-width is 700px, so original dimensions were excessive
  - Base64 encoding savings: ~973KB per email when used as inline attachment
  - Committed in: 5f62c15 "Optimize OASA banner: reduce size from 886KB to 154KB"

## Previous Releases

### [2.0.0] - 2026-03-01
- Initial release with core newsletter subscription and delivery system
- Azure integration (PostgreSQL, Communication Services, Functions)
- RSS feed aggregation from SpaceNews, NASA, ESA
- OASA event blurbs with countdown label suppression
- Daily and weekly newsletter frequency options
- Topic-based preferences and repeat suppression
