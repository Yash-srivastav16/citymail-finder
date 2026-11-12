# Chrome Web Store listing draft — CityMail Finder

> Status: draft only. Do not submit this listing with the current Google Search automation. The extension currently sends automated Google Search queries and reads result pages. Google Search's machine-generated traffic policy says automated queries/scraping without express permission are not allowed. Obtain written express permission or replace this workflow with a source whose terms permit the intended automated access before submission or commercial use.

## Product name
CityMail Finder

## Short description
Organize city-based email research, deduplicate visible email matches, and export results locally.

## Detailed description
CityMail Finder helps organize business-contact research by city.

- Import a CSV or Excel file containing a `City` column, or enter cities manually.
- Configure a search query using the `{city}` placeholder.
- Set the number of result pages to process per city (up to 50).
- Identify email-shaped text visible on search result pages.
- Deduplicate matching addresses and keep results in the browser.
- Export unique email matches to an Excel workbook.
- Remove individual results or clear saved data.

**Important workflow disclosure:** The current build automatically opens and navigates Google Search result pages and reads visible result text. Google may display verification challenges; users must complete them manually. The extension does not crawl linked business websites, verify deliverability, or send email. Search results may be incomplete or inaccurate.

**Data handling:** City lists, settings, progress and collected results are stored in the browser. The current build does not upload the collected list to a CityMail Finder server. Search requests are sent directly from the browser to Google, which handles them under its own policies.

Use collected contact information only where permitted by applicable privacy, data-protection and marketing laws. Public visibility does not itself establish permission to contact someone.

## Category
Productivity (confirm the closest available category in the current Web Store dashboard).

## Language
English

## Privacy policy URL
https://yash-srivastav16.github.io/citymail-finder/privacy.html

This URL is the canonical URL in docs/privacy.html, but it still needs a live browser check before submission.

## Screenshot plan (capture from the actual packaged extension)
Do not use mockups or fabricated UI. Capture at least one genuine screenshot at the Web Store's currently accepted dimensions (for example, 1280×800 or 640×400):
1. Main workspace showing city import/manual entry and query/page controls.
2. Results view showing the email list and export/delete controls.
3. Optional: a separate genuine screenshot showing progress/status and manual verification instructions.

Avoid screenshots that imply guaranteed discovery, verified deliverability, Google endorsement, or unsupported website crawling.

## Store dashboard privacy declarations — verify against final packaged code
- Data handled: email addresses and user-provided city names/search settings.
- Purpose: core functionality (organizing and exporting research results).
- Sale/transfer: current code does not upload the collected list to a CityMail Finder backend.
- Authentication: no CityMail Finder account is required.
- Privacy policy and dashboard declarations must match the exact uploaded ZIP and current code.
- Permission justifications:
  - tabs: open, monitor, update and close the search tab.
  - scripting: read visible result-page text.
  - unlimitedStorage: store the local IndexedDB result collection.
  - https://www.google.com/search*: restrict script access to Google Search result pages.

Do not assert the extension is Google-approved, that email addresses are verified, or that the results are exhaustive.
