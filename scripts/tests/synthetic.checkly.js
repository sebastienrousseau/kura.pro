/**
 * Checkly / Datadog Synthetic Monitoring Script
 *
 * Deploy to Checkly to monitor CloudCDN from global PoPs.
 * Runs every 1 minute from Tokyo, London, and New York.
 *
 * Checks:
 *   1. Static asset availability + cache headers
 *   2. Geo-routing returns correct X-CDN-Region header
 *   3. API endpoints respond within SLA
 *   4. Transform API generates images
 */

const { expect, test } = require('@playwright/test');
// For Checkly, use: const { expect } = require('expect');

const BASE = 'https://cloudcdn.pro';

// 1. Static asset health
test('static asset served with immutable cache', async ({ request }) => {
  const res = await request.get(`${BASE}/cloudcdn/v1/logos/cloudcdn.svg`);
  expect(res.status()).toBe(200);
  expect(res.headers()['cache-control']).toContain('immutable');
  expect(res.headers()['cache-tag']).toContain('project-cloudcdn');
  expect(res.headers()['access-control-allow-origin']).toBe('*');
});

// 2. Geo-routing (assert from the region the check runs in)
test('geo-routing adds X-CDN-Region header', async ({ request }) => {
  const res = await request.get(`${BASE}/global/banner.webp`);
  // Should return a region header even if the file 404s
  const region = res.headers()['x-cdn-region'];
  expect(region).toBeTruthy();
  expect(['europe', 'asia', 'north-america', 'south-america', 'africa', 'oceania']).toContain(region);
});

// 3. Search API responsiveness
test('search API responds within 500ms', async ({ request }) => {
  const start = Date.now();
  const res = await request.get(`${BASE}/api/search?q=logo&limit=5`);
  const elapsed = Date.now() - start;
  expect(res.status()).toBe(200);
  expect(elapsed).toBeLessThan(500);
  const body = await res.json();
  expect(body.results).toBeDefined();
});

// 4. Transform API generates image
test('transform API returns image', async ({ request }) => {
  const res = await request.get(`${BASE}/api/transform?url=/cloudcdn/v1/logos/cloudcdn.svg&w=64&format=webp`);
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image');
});

// 5. Dashboard loads
test('dashboard loads manifest and renders', async ({ page }) => {
  await page.goto(`${BASE}/dashboard/`);
  await page.waitForSelector('.asset-card', { timeout: 5000 });
  const cards = await page.locator('.asset-card').count();
  expect(cards).toBeGreaterThan(0);
});
