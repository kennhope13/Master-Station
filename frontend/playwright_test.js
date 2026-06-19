import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  page.on('console', msg => {
    console.log('BROWSER CONSOLE:', msg.text());
  });

  console.log('Navigating to login page...');
  await page.goto('http://localhost:6173/login');

  console.log('Logging in...');
  await page.fill('input[placeholder="multi"]', 'provinceadmin');
  await page.fill('input[placeholder="••••••••"]', 'Province@123');
  await page.click('button:has-text("ĐĂNG NHẬP")');

  console.log('Waiting for navigation to multisite...');
  await page.waitForURL('**/multisite');
  console.log('Logged in successfully!');

  console.log('Clicking NGƯỜI DÙNG tab...');
  await page.click('button:has-text("NGƯỜI DÙNG")');

  console.log('Waiting for load...');
  await page.waitForTimeout(5000); // Wait 5 seconds

  console.log('Current URL is:', page.url());

  await browser.close();
  console.log('Done.');
})();
