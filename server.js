/*
 * Server Node para desarrollo local y pruebas Docker/E2E.
 * Sirve el sitio estático y monta /api/onboarding con el mismo handler que usa Vercel.
 * Producción real corre en Vercel (estático + funciones); este server no se despliega.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const onboardingHandler = require('./api/onboarding.js');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const MIME = {
    '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'application/javascript',
    '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml',
    '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2'
};

const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/onboarding') return onboardingHandler(req, res);

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
