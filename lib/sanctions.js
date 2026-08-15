/*
 * Screening de listas públicas de sanciones — motor propio, sin costo.
 * Fuente activa: lista SDN de OFAC (Tesoro de EE. UU., descarga pública CSV).
 * La lista se cachea en memoria de la instancia por 24 h (Fluid Compute reutiliza
 * instancias, así que la descarga fría es poco frecuente).
 *
 * Proveedores comerciales (Truora, Sumsub, etc.) se pueden conectar después vía
 * las variables de entorno KYC_PROVIDER / KYC_PROVIDER_KEY: ver screenWithProvider().
 */
const https = require('https');
const { getPool, ensureSchema } = require('./db.js');

const OFAC_SDN_CSV = 'https://www.treasury.gov/ofac/downloads/sdn.csv';
const MEMORY_TTL_MS = 24 * 60 * 60 * 1000;       // caché en memoria de la instancia
const DB_TTL_MS = 7 * 24 * 60 * 60 * 1000;       // caché compartida en Postgres
const DOWNLOAD_TIMEOUT_MS = 25000;               // el servidor de OFAC es lento; si no llega, revisión manual
const CACHE_KEY = 'ofac_sdn';

let cache = { at: 0, entries: null, loading: null };

function fetchUrl(url, timeoutMs) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, {
            timeout: timeoutMs,
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NovaCoinKYC/1.0)' }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return fetchUrl(res.headers.location, timeoutMs).then(resolve, reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        });
        req.on('timeout', () => { req.destroy(new Error('timeout')); });
        req.on('error', reject);
    });
}

function normalizeName(s) {
    return String(s || '').toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-Z ]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function splitCsvLine(line) {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') {
                if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
            } else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === ',') { fields.push(cur); cur = ''; }
        else cur += ch;
    }
    fields.push(cur);
    return fields;
}

function clean(v) {
    const s = String(v || '').trim();
    return s === '-0-' ? '' : s;
}

function parseSdnCsv(csv) {
    // Formato OFAC: ent_num,"SDN_Name",SDN_Type,"Program(s)",...  ('-0-' = vacío)
    const entries = [];
    for (const line of csv.split('\n')) {
        if (!line.trim()) continue;
        const f = splitCsvLine(line);
        if (f.length < 4) continue;
        const name = clean(f[1]);
        const norm = normalizeName(name);
        if (norm.length < 5) continue;
        entries.push({
            name,
            norm,
            tokens: norm.split(' ').filter((t) => t.length > 2),
            type: clean(f[2]) || 'entity',
            program: clean(f[3])
        });
    }
    return entries;
}

function hydrate(records) {
    return records.map((r) => {
        const norm = normalizeName(r.name);
        return { name: r.name, norm, tokens: norm.split(' ').filter((t) => t.length > 2), type: r.type, program: r.program };
    });
}

async function readDbCache() {
    const pool = getPool();
    if (!pool) return null;
    await ensureSchema();
    const r = await pool.query('SELECT value, updated_at FROM kv_cache WHERE key = $1', [CACHE_KEY]);
    if (!r.rows.length) return null;
    const age = Date.now() - new Date(r.rows[0].updated_at).getTime();
    if (age > DB_TTL_MS) return null;
    return hydrate(r.rows[0].value);
}

async function writeDbCache(entries) {
    const pool = getPool();
    if (!pool) return;
    await ensureSchema();
    const slim = entries.map((e) => ({ name: e.name, type: e.type, program: e.program }));
    await pool.query(
        `INSERT INTO kv_cache (key, value, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [CACHE_KEY, JSON.stringify(slim)]
    );
}

async function loadList() {
    const now = Date.now();
    if (cache.entries && now - cache.at < MEMORY_TTL_MS) return cache.entries;
    if (!cache.loading) {
        cache.loading = (async () => {
            // 1) caché compartida en la DB (rápida, la llena cualquier instancia)
            try {
                const fromDb = await readDbCache();
                if (fromDb && fromDb.length) {
                    cache = { at: Date.now(), entries: fromDb, loading: null };
                    return cache.entries;
                }
            } catch (e) { /* sin DB o caché vencida: descarga directa */ }
            // 2) descarga de la fuente oficial y siembra de la caché
            const csv = await fetchUrl(OFAC_SDN_CSV, DOWNLOAD_TIMEOUT_MS);
            const entries = parseSdnCsv(csv);
            cache = { at: Date.now(), entries, loading: null };
            writeDbCache(entries).catch(() => {});
            return entries;
        })().catch((e) => { cache.loading = null; throw e; });
    }
    return cache.loading;
}

function matchName(candidateNorm, entries) {
    const tokens = candidateNorm.split(' ').filter((t) => t.length > 2);
    if (tokens.length < 2) return [];
    const matches = [];
    for (const e of entries) {
        let shared = 0;
        for (const t of tokens) if (e.tokens.indexOf(t) !== -1) shared++;
        // conservador: al menos 2 tokens compartidos y ≥75% del nombre del solicitante
        if (shared >= 2 && shared / tokens.length >= 0.75) {
            matches.push({ list: 'OFAC_SDN', name: e.name, type: e.type, program: e.program });
            if (matches.length >= 5) break;
        }
    }
    return matches;
}

/**
 * Revisa nombres contra las listas. Nunca lanza: si la lista no se pudo
 * descargar devuelve status 'unavailable' para revisión manual.
 */
async function screenNames(names) {
    if (process.env.SANCTIONS_SCREENING === 'off') {
        return { engine: 'ofac-sdn', status: 'disabled', matches: [] };
    }
    const candidates = names.filter(Boolean).map(normalizeName).filter((n) => n.length >= 5);
    if (!candidates.length) return { engine: 'ofac-sdn', status: 'skipped', matches: [] };
    try {
        const entries = await loadList();
        const matches = [];
        for (const c of candidates) matches.push(...matchName(c, entries));
        return {
            engine: 'ofac-sdn',
            status: matches.length ? 'hit' : 'clear',
            listSize: entries.length,
            matches
        };
    } catch (e) {
        return { engine: 'ofac-sdn', status: 'unavailable', error: e.message, matches: [] };
    }
}

/**
 * Punto de conexión para proveedores KYC comerciales (Truora, Sumsub, MetaMap…).
 * Se activará cuando KYC_PROVIDER y KYC_PROVIDER_KEY estén configurados.
 */
async function screenWithProvider(payload) {
    if (!process.env.KYC_PROVIDER || !process.env.KYC_PROVIDER_KEY) return null;
    // TODO: implementar la integración del proveedor elegido.
    return { engine: process.env.KYC_PROVIDER, status: 'not_implemented' };
}

module.exports = { screenNames, screenWithProvider, normalizeName, parseSdnCsv, writeDbCache };
