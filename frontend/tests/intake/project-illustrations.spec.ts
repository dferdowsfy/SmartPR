import { expect, test, type Page } from '@playwright/test';

async function setup(page: Page, businessType = 'Restaurant') {
  const state = { businessType, transcript: '', projectContext: {} as Record<string, unknown> };
  await page.route('**/api/**', async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/api/me') return route.fulfill({ json: { user: null } });
    if (pathname === '/api/intake/voice') return route.fulfill({ json: { transcript: state.transcript } });
    if (pathname === '/api/intake/interpret') {
      const id = state.businessType === 'Bar' ? 'BT_BAR' : state.businessType === 'Warehouse Operator' ? 'BT_WAREHOUSE_OPERATOR' : 'BT_RESTAURANT';
      return route.fulfill({ json: {
        interpretation: {
          businessType: { id, name: state.businessType, confidence: 0.99 },
          municipality: { value: 'San Juan', confidence: 0.99 },
          profileValues: [{ key: 'location_type', value: state.businessType === 'Warehouse Operator' ? 'Warehouse' : 'Restaurant / Food Service Location', confidence: 0.99 }],
          answers: [],
        },
        projectContext: state.projectContext,
      } });
    }
    return route.fulfill({ status: 404, json: {} });
  });
  const hydrated = page.waitForResponse((response) => new URL(response.url()).pathname === '/api/me');
  await page.goto('/?entry=new-business');
  await hydrated;
  return state;
}
const projectImage = (page: Page) => page.locator('aside.spr-project-summary img');
async function submitDescription(page: Page, description: string) {
  await page.locator('#spr-nl-input').fill(description);
  await page.getByRole('button', { name: 'Interpret description', exact: true }).click();
  await expect(page.getByTestId('guided-project-brief')).toBeVisible();
}

test('typed request selects illustration automatically and a replacement request updates it', async ({ page }) => {
  const state = await setup(page);
  await submitDescription(page, 'I want to open a restaurant in San Juan at a restaurant location.');
  await expect(projectImage(page)).toHaveAttribute('src', /restaurant\.png/);
  await expect(page.locator('#spr-business-type')).not.toBeVisible();
  await expect(page.locator('#spr-nl-input')).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Fill in fields by voice', exact: true })).toBeVisible();
  state.businessType = 'Bar';
  await page.locator('.spr-nl-edit').click();
  await submitDescription(page, 'I want to open a bar in San Juan at a restaurant location.');
  await expect(projectImage(page)).toHaveAttribute('src', /bar\.png/);
  expect(await page.locator('.spr-form input:visible, .spr-form select:visible').count()).toBeLessThanOrEqual(1);
});

test('spoken request uses the same pipeline and chooses bar artwork without a selector', async ({ page }) => {
  const state = await setup(page, 'Bar');
  state.transcript = 'I want to open a bar in San Juan at a restaurant location.';
  await page.getByRole('button', { name: 'Fill in fields by voice', exact: true }).click();
  const stop = page.getByRole('button', { name: 'Stop recording and use speech', exact: true });
  await expect(stop).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1200);
  await stop.click();
  await expect(projectImage(page)).toHaveAttribute('src', /bar\.png/);
  await expect(page.getByTestId('guided-project-brief')).toBeVisible();
});

test('project-only solar request picks matching artwork from structured facts', async ({ page }) => {
  const state = await setup(page, 'Warehouse Operator');
  state.projectContext = { generation_technology: { value: 'solar', confidence: 0.99, evidence: 'rooftop solar' } };
  await submitDescription(page, 'We own an existing warehouse in San Juan and want to install rooftop solar.');
  await expect(projectImage(page)).toHaveAttribute('src', /solar-warehouse\.png/);
  await expect(page.getByRole('heading', { name: 'A few details, then your requirements.' })).toBeVisible();
  await expect(page.locator('.spr-guided-steps [aria-current=step]')).toContainText('Confirm details');
  await expect.poll(() => projectImage(page).evaluate((image) => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0 && (image as HTMLImageElement).currentSrc.includes('solar-warehouse'))).toBe(true);
  await page.screenshot({ path: 'test-results/guided-intake-desktop.png', fullPage: true });
});

test('mobile keeps request first, uses neutral default, and has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await setup(page);
  await expect(page.locator('#spr-nl-input')).toBeVisible();
  await expect(projectImage(page)).toHaveAttribute('src', /default\.png/);
  const inputBox = await page.locator('#spr-nl-input').boundingBox();
  const imageBox = await projectImage(page).boundingBox();
  expect(inputBox!.y).toBeLessThan(imageBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/guided-intake-mobile.png', fullPage: true });
});
