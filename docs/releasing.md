# Extension release process

This workflow deliberately separates building from publishing to the Chrome Web Store.

## Normal development

1. Create a feature branch from `main`.
2. Open a pull request.
3. GitHub Actions builds the extension and validates the generated `dist/` directory.
4. Review and merge the pull request after tests pass.

Pull-request and main-branch builds do **not** publish to the Chrome Web Store.

## Create a versioned release package

1. Update the extension version in both `package.json` and `public/manifest.json` to the same new version (for example, `1.1.3`).
2. Merge the version bump and approved changes into `main`.
3. Create and push a matching tag from the merged commit:

   ```bash
   git checkout main
   git pull
   git tag v1.1.3
   git push origin v1.1.3
   ```

4. The `Package extension release` workflow builds the extension, checks that the tag matches the manifest version, and creates a ZIP containing the **contents** of `dist/` (so `manifest.json` is at the ZIP root).
5. The workflow attaches the ZIP to a GitHub Release and retains it as a workflow artifact.

## Publish to Chrome Web Store

GitHub release creation does not publish the extension to the Chrome Web Store.

1. Open the GitHub Release and download its ZIP asset.
2. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/dev-dashboard/).
3. Select CityMail Finder and upload the ZIP as a new package.
4. Review the permissions and store listing disclosures.
5. Submit for review and publish through the dashboard.

Chrome Web Store submission remains a manual, explicit approval step. No workflow in this repository uploads or publishes to the store automatically.

## Rollback

Use the Chrome Web Store Developer Dashboard's available publishing controls to manage a problematic release. Keep prior GitHub Release ZIPs for reproducible builds and investigation.
