# CityMail Finder — release QA checklist

Run these tests against the exact ZIP generated from the final commit, in a clean Chrome profile. Record Chrome version, OS, build commit and pass/fail for each case. No clean-profile manual test has yet been recorded.

## Build and package
- [ ] Install dependencies using the repository's documented install command.
- [ ] Run `npm run build`; confirm it exits successfully.
- [ ] Confirm `dist/manifest.json`, `dist/index.html`, `dist/background.js`, and all referenced icons exist.
- [ ] Inspect the generated ZIP; ensure it contains the contents of `dist/` at the ZIP root (not a nested dist folder).
- [ ] Confirm the manifest version and displayed product name are correct.
- [ ] Confirm there are no development secrets, source maps containing secrets, test fixtures with personal data, or unexpected files in the ZIP.

## Install and basic use
- [ ] Load the unpacked `dist` folder in a clean Chrome profile.
- [ ] Confirm the extension action opens the CityMail Finder UI.
- [ ] Import a valid CSV with a City header.
- [ ] Import a valid XLSX with a City header.
- [ ] Reject a file without a City header with a clear error.
- [ ] Add cities manually using newlines, commas and semicolons.
- [ ] Confirm duplicate city names are not added.
- [ ] Remove one city and clear all cities.
- [ ] Change the query and page count, reload the extension page, and confirm settings persist.
- [ ] Confirm the page count is constrained to 1–50.

## Search workflow (only after source/provider authorization is resolved)
- [ ] Test with a provider and method whose terms expressly permit this automated access.
- [ ] Confirm correct query substitution for city names with spaces and punctuation.
- [ ] Confirm next-page navigation and resume checkpoint behaviour.
- [ ] Confirm a failed navigation produces a useful status and does not silently skip data.
- [ ] Confirm duplicate email matches are deduplicated case-insensitively.
- [ ] Confirm CAPTCHA/verification challenges require the user to solve them manually in the Google tab; no automated solving, bypass, or circumvention occurs.
- [ ] Confirm the user can resume after manually clearing a challenge, and that a still-visible challenge leaves the workflow paused with clear instructions.
- [ ] Confirm the UI and store description clearly state that every extracted email match is unverified and must be independently checked for validity, deliverability, and business association.
- [ ] Confirm stopping/closing Chrome does not corrupt saved results.
- [ ] Confirm no hidden or unexpected background requests occur.

## Results, export and deletion
- [ ] Confirm results survive closing/reopening the extension.
- [ ] Confirm source city and source URL fields are correct.
- [ ] Remove one result and verify it is gone after reload.
- [ ] Clear collected emails and verify IndexedDB is empty.
- [ ] Clear all data and verify cities, query, page count, progress and results are reset.
- [ ] Export a workbook and open it in Excel/LibreOffice.
- [ ] Confirm exported addresses are unique and headers are correct.
- [ ] Test empty-result export and large result collections.

## Privacy, permissions and store readiness
- [ ] Verify privacy policy URL loads publicly without login, redirects or certificate errors.
- [ ] Compare the live privacy policy with the exact packaged build.
- [ ] Verify every Web Store privacy/data-use answer against the final code.
- [ ] Justify each permission with a concrete user-facing feature; remove any permission no longer needed.
- [ ] Verify the final search provider's terms authorize the intended automated access and commercial use.
- [ ] Capture real screenshots from the packaged build at accepted Web Store dimensions.
- [ ] Confirm short and detailed descriptions match actual functionality.
- [ ] Confirm no Google endorsement/approval or email verification is implied.
- [ ] Confirm support contact and privacy policy links work.

## Release decision
- [ ] All automated CI checks pass on the final commit.
- [ ] All applicable manual QA items pass and evidence is recorded.
- [ ] Search-provider authorization is documented.
- [ ] Only then upload the ZIP and submit for review.

**Current known blocker:** the current implementation automates Google Search queries. Do not treat this checklist or a successful build as authorization to submit that workflow.
