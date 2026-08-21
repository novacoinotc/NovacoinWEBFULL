#!/usr/bin/env node
/*
 * Descarga e indexa las listas públicas de sanciones en Postgres.
 * Uso:  node scripts/refresh-lists.js            (todas)
 *       node scripts/refresh-lists.js un sat_69b (solo algunas)
 */
const fs = require('fs');
const path = require('path');
try {
    fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split('\n').forEach((l) => {
        const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    });
} catch (e) { /* sin .env: se usan las variables del entorno */ }

const sanctions = require('../lib/sanctions.js');
const { getPool } = require('../lib/db.js');

const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(sanctions.SOURCES);

(async () => {
    let totalOk = 0, totalFail = 0;
    for (const key of targets) {
        const t0 = Date.now();
        process.stdout.write('→ ' + key + ' … ');
        try {
            const r = await sanctions.refreshList(key);
            console.log('✓ ' + r.count.toLocaleString('es-MX') + ' registros (' + Math.round((Date.now() - t0) / 1000) + 's)');
            totalOk++;
        } catch (e) {
            console.log('✗ ' + e.message);
            totalFail++;
        }
    }
    const status = await sanctions.listStatus();
    console.log('\nEstado de las listas:');
    status.forEach((s) => console.log('  ' + (s.indexed || 0).toLocaleString('es-MX').padStart(8) + '  ' + s.label + (s.last_error ? '  ⚠ ' + s.last_error : '')));
    const total = status.reduce((a, s) => a + (s.indexed || 0), 0);
    console.log('  ' + total.toLocaleString('es-MX').padStart(8) + '  TOTAL indexado');
    const pool = getPool();
    if (pool) await pool.end();
    process.exit(totalFail && !totalOk ? 1 : 0);
})();
