// Config Playwright — corre contra el server local o contra el contenedor Docker (BASE_URL)
const { defineConfig, devices } = require('@playwright/test');

const BASE_URL = process.env.BASE_URL || 'http://localhost:8080';

module.exports = defineConfig({
    testDir: './tests/e2e',
    timeout: 60000,
    retries: 1,
    reporter: [['list']],
    use: {
        baseURL: BASE_URL,
        trace: 'retain-on-failure',
        permissions: ['camera'],
        launchOptions: {
            args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']
        }
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'mobile', use: { ...devices['Pixel 7'] }, testIgnore: /camera/ }
    ],
    webServer: {
        command: 'node server.js',
        url: BASE_URL + '/onboarding/',
        reuseExistingServer: true,
        timeout: 30000
    }
});
