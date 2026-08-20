/*
 * Server Node para desarrollo local y pruebas Docker/E2E.
 * Sirve el sitio estático y monta /api/onboarding con el mismo handler que usa Vercel.
 * Producción real corre en Vercel (estático + funciones); este server no se despliega.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

// Carga .env local si existe (sin dependencia de dotenv)
try {
    const envFile = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
    envFile.split('\n').forEach((line) => {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
} catch (e) { /* sin .env */ }

const onboardingHandler = require('./api/onboarding.js');
const trackHandler = require('./api/track.js');
const adminHandler = require('./api/admin.js');

const PORT = process.env.PORT || 8080;
// Salvaguarda: el puerto de pruebas jamás debe hablar con la base de datos real
if (String(PORT) === '8099') process.env.DATABASE_URL = '';
const ROOT = __dirname;
const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/onboarding') return onboardingHandler(req, res);
    if (url.pathname === '/api/track') return trackHandler(req, res);
    if (url.pathname === '/api/admin') return adminHandler(req, res);

    let filePath = path.normalize(path.join(ROOT, decodeURIComponent(url.pathname)));
    if (!filePath.startsWith(ROOT)) { res.statusCode = 403; return res.end('Forbidden'); }
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => console.log('NovaCoin web en http://localhost:' + PORT));
