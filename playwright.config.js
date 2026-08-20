// Config Playwright — corre contra el server local o contra el contenedor Docker (BASE_URL)
const { defineConfig, devices } = require('@playwright/test');

// Puerto propio de pruebas (8099): nunca colisiona con el server de desarrollo
// ni con el contenedor Docker, que sí pueden apuntar a la base de datos real.
const BASE_URL = process.env.BASE_URL || 'http://localhost:8099';

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
        // Nunca reutilizar un server ajeno: podría estar conectado a la DB real
        reuseExistingServer: false,
        timeout: 30000,
        // Las pruebas corren sin DB (no ensucian Neon) y con clave admin propia
        env: { PORT: '8099', DATABASE_URL: '', ADMIN_KEY: 'test-admin-key', SANCTIONS_SCREENING: 'off' }
    }
});
