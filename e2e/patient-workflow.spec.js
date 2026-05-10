const { test, expect } = require('@playwright/test')

test.describe('Remedacare app shell', () => {
  test('loads the login page successfully', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('text=Sign In')).toBeVisible()
    await expect(page.locator('input[placeholder="admin@hospital.co.ke"]')).toBeVisible()
    await expect(page.locator('button:has-text("Sign In")')).toBeVisible()
  })
})
