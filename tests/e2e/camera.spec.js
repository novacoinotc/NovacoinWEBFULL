// Prueba de cámara con dispositivo falso de Chromium (--use-fake-device-for-media-stream)
const { test, expect } = require('@playwright/test');

test('captura selfie con la cámara', async ({ page }) => {
    await page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.goto('/onboarding/');
    await page.evaluate(() => localStorage.clear());

    // navegar directo al paso de selfie manipulando el wizard no es posible sin
    // estado previo, así que probamos el flujo de cámara aislando el paso:
    await page.getByTestId('platform-rfq').click();
    await page.getByTestId('next-btn').click();
    // El paso de selfie exige llegar con datos; verificamos aquí solo el hardware:
    // abrimos la cámara desde el DOM del paso 7 (oculto ≠ deshabilitado para JS)
    await page.evaluate(() => {
        document.querySelectorAll('.onb-step').forEach((s) => { s.hidden = s.dataset.step !== '7'; });
    });
    await page.getByTestId('open-camera').click();
    await expect(page.locator('#selfieCamera')).toBeVisible();
    await expect(page.locator('#selfieVideo')).toBeVisible();
    // el stream falso tarda un instante en producir frames
    await page.waitForFunction(() => document.getElementById('selfieVideo').videoWidth > 0);
    await page.getByTestId('capture-selfie').click();
    await expect(page.locator('[data-upload-preview="selfie"]')).toBeVisible();
    await expect(page.locator('[data-upload-preview="selfie"] img')).toBeVisible();
});
