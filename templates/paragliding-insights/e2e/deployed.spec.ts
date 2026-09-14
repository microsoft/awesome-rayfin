import { expect, test } from '@playwright/test';

/**
 * Smoke test against the deployed Fabric App. Skipped unless GLEITSCHIRM_DEPLOYED_URL is set, so
 * the normal `npm run test:e2e` stays offline and fast.
 *
 *   $env:GLEITSCHIRM_DEPLOYED_URL = 'https://<host>.webapp.fabricapps.net'; npx playwright test deployed
 *
 * The URL is not hard-coded: Rayfin issues a new host per project and it lives in the
 * (gitignored) rayfin/.deployments.json.
 */
const deployedUrl = process.env.GLEITSCHIRM_DEPLOYED_URL;

test.describe('deployed Fabric App', () => {
  test.skip(!deployedUrl, 'set GLEITSCHIRM_DEPLOYED_URL to run');

  test('serves the shell with its data attribution', async ({ page }) => {
    await page.goto(deployedUrl!);

    await expect(page.getByTestId('twin-shell')).toBeVisible();

    // The attribution is a licence obligation, not decoration: CC BY 4.0 prescribes the wording
    // of the geobasis notice, so a deploy that dropped the footer would be a licence breach
    // rather than a cosmetic regression.
    await expect(page.getByTestId('attribution')).toContainText('Vermessungsverwaltung');
    await expect(page.getByTestId('attribution')).toContainText('OpenStreetMap');
  });
});
