const { test, expect } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.describe('StegoChat full conversation', () => {
    let contextA, contextB, pageA, pageB;
    const imagePath = path.resolve(__dirname, 'assets/test-image.png');

    test.beforeAll(async ({ browser }) => {
        contextA = await browser.newContext();
        contextB = await browser.newContext();
        pageA = await contextA.newPage();
        pageB = await contextB.newPage();
        await pageA.goto('http://localhost:5173');
        await pageB.goto('http://localhost:5173');
        await pageA.evaluate(() => window.__TEST_MODE = true);
        await pageB.evaluate(() => window.__TEST_MODE = true);
    });

    test.afterAll(async () => {
        await contextA.close();
        await contextB.close();
    });

    test('bidirectional ratcheted messaging', async () => {
        await pageA.waitForSelector('text=New Conversation');
        await pageA.getByText('New Conversation').click();
        await pageA.getByText('Create').click();
        const qrPayload = await extractQrPayload(pageA);

        await pageB.getByText('New Conversation').click();
        await pageB.evaluate(payload => window.__processQrPayload(payload), qrPayload);
        await pageB.waitForTimeout(500);
        const qrPayloadBack = await extractQrPayload(pageB);
        await pageA.evaluate(payload => window.__processQrPayload(payload), qrPayloadBack);
        await pageA.waitForTimeout(500);

        await pageA.waitForSelector('text=Ratchet key exchange complete');
        await pageB.waitForSelector('text=Ratchet key exchange complete');


        await pageB.getByText('Conversation 1').click();

        await pageA.getByPlaceholder('Type your message...').fill('The pigeon flies at midnight.');
        await pageA.setInputFiles('input[type="file"]', imagePath);
        const download1 = await simulateDownload(pageA, 'Encode');

        await pageB.locator('label:has-text("Decode") input[type="file"]').setInputFiles(download1);
        await pageB.waitForTimeout(100);
        await expect(pageB.locator('text=The pigeon flies at midnight.')).toHaveCount(1, { timeout: 2000 });

        await pageB.getByPlaceholder('Type your message...').fill("The frog hops across the pond.");
        await pageB.setInputFiles('input[type="file"]', imagePath);
        const download2 = await simulateDownload(pageB, 'Encode');

        await pageA.locator('label:has-text("Decode") input[type="file"]').setInputFiles(download2);
        await expect(pageA.locator("text=The frog hops across the pond.")).toBeVisible();

        await pageA.getByPlaceholder('Type your message...').fill("The horse trots in the field.");
        await pageA.setInputFiles('input[type="file"]', imagePath);
        const download3 = await simulateDownload(pageA, 'Encode');

        await pageB.locator('label:has-text("Decode") input[type="file"]').setInputFiles(download3);
        await expect(pageB.locator("text=The horse trots in the field.")).toBeVisible();


        const [alert] = await Promise.all([
            pageB.waitForEvent('dialog'),
            pageB.locator('label:has-text("Decode") input[type="file"]').setInputFiles(download3)
        ]);
        expect(alert.message()).toContain('Decryption failed');
        await alert.dismiss();
    });
});

async function extractQrPayload(page) {
    return await page.waitForFunction(() => {
        return typeof window.__qrPayload === 'string';
    }).then(() => page.evaluate(() => window.__qrPayload));
}

async function simulateDownload(page, buttonLabel) {
    const [download] = await Promise.all([
        page.waitForEvent('download'),
        page.getByText(buttonLabel).click()
    ]);
    const tempPath = await download.path();
    const copyPath = tempPath + '.png';
    fs.copyFileSync(tempPath, copyPath);
    return copyPath;
}
