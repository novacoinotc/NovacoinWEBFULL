/*
 * Motor de screening contra listas públicas de sanciones y listas negras.
 * Fuentes (todas públicas y gratuitas, sin llave de API):
 *   - OFAC SDN y OFAC Consolidada (no-SDN) — Tesoro de EE. UU.
 *   - Consolidada del Consejo de Seguridad de la ONU
 *   - Sanciones financieras del Reino Unido (OFSI)
 *   - Lista consolidada de la Unión Europea (FSF)
 *   - Artículo 69-B del SAT (EFOS: empresas que facturan operaciones simuladas)
 *
 * Las listas se descargan con `npm run refresh-lists` (o desde el dashboard) y
 * se indexan en Postgres (tabla sanctions_entries, índice GIN sobre tokens),
 * de modo que cada consulta es una sola query y no carga nada en memoria.
 *
 * NOTA DE CUMPLIMIENTO: la Lista de Personas Bloqueadas (LPB) de la UIF/SHCP es
 * confidencial y solo se obtiene con credenciales de sujeto obligado en SITI
 * PLD/FT o SPPLD; no puede integrarse aquí de forma automática.
 *
 * Proveedores comerciales (Truora, Sumsub…) se conectan vía KYC_PROVIDER.
 */
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const { getPool, ensureSchema } = require('./db.js');

const SOURCES = {
    ofac_sdn: {
        label: 'OFAC SDN (EE. UU.)',
        url: 'https://www.treasury.gov/ofac/downloads/sdn.csv',
        parser: 'ofac', encoding: 'utf8'
    },
    ofac_cons: {
        label: 'OFAC Consolidada no-SDN (EE. UU.)',
        url: 'https://www.treasury.gov/ofac/downloads/consolidated/cons_prim.csv',
        parser: 'ofac', encoding: 'utf8'
    },
    un: {
        label: 'Consejo de Seguridad de la ONU',
        url: 'https://scsanctions.un.org/resources/xml/en/consolidated.xml',
        parser: 'un', encoding: 'utf8'
    },
    uk: {
        label: 'Sanciones financieras del Reino Unido (OFSI)',
        url: 'https://ofsistorage.blob.core.windows.net/publishlive/2022format/ConList.csv',
        parser: 'uk', encoding: 'utf8'
    },
    eu: {
        label: 'Lista consolidada de la Unión Europea',
        url: 'https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw',
        parser: 'eu', encoding: 'utf8'
    },
    sat_69b: {
        label: 'SAT 69-B (EFOS: facturas simuladas)',
        url: 'http://omawww.sat.gob.mx/cifras_sat/Documents/Listado_Completo_69-B.csv',
        parser: 'sat69b', encoding: 'latin1'
    }
};

// Palabras que no aportan identidad y dispararían falsos positivos
const STOPWORDS = new Set(['SOCIEDAD', 'ANONIMA', 'ANONIMO', 'CAPITAL', 'VARIABLE', 'RESPONSABILIDAD',
    'LIMITADA', 'GRUPO', 'COMPANY', 'COMPANIA', 'LIMITED', 'CORPORATION', 'CORP', 'INTERNATIONAL',
    'INTERNACIONAL', 'SERVICES', 'SERVICIOS', 'TRADING', 'HOLDING', 'HOLDINGS', 'GROUP', 'THE', 'AND',
    'FOR', 'LLC', 'INC', 'LTD', 'SRL', 'SAPI', 'SAS', 'SDE', 'DEL', 'LOS', 'LAS', 'CON', 'POR', 'SUS']);

/* ─────────── utilidades ─────────── */

function normalizeName(s) {
    return String(s || '').toUpperCase()
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^A-ZÑ0-9 ]/g, ' ')
        .replace(/\s+/g, ' ').trim();
}

function tokenize(norm) {
    return Array.from(new Set(
        norm.split(' ').filter((t) => t.length > 2 && !STOPWORDS.has(t))
    ));
}

function fetchUrl(url, timeoutMs, redirects) {
    redirects = redirects || 0;
    return new Promise((resolve, reject) => {
        if (redirects > 5) return reject(new Error('demasiadas redirecciones'));
        const mod = url.startsWith('http://') ? http : https;
        const req = mod.get(url, {
            timeout: timeoutMs,
            headers: {
                'User-Agent': 'Mozilla/5.0 (compatible; NovaCoinKYC/1.0)',
                'Accept-Encoding': 'gzip, deflate'
            }
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                res.resume();
                const next = new URL(res.headers.location, url).toString();
                return fetchUrl(next, timeoutMs, redirects + 1).then(resolve, reject);
            }
            if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
            const enc = (res.headers['content-encoding'] || '').toLowerCase();
            const stream = enc === 'gzip' ? res.pipe(zlib.createGunzip())
                : enc === 'deflate' ? res.pipe(zlib.createInflate()) : res;
            const chunks = [];
            stream.on('data', (c) => chunks.push(c));
            stream.on('end', () => resolve(Buffer.concat(chunks)));
            stream.on('error', reject);
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', reject);
    });
}

function splitDelimited(line, delim) {
    const fields = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inQ) {
            if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
            else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === delim) { fields.push(cur); cur = ''; }
        else cur += ch;
    }
    fields.push(cur);
    return fields;
}

// Divide respetando comillas que abarcan varios renglones (UK y UE lo hacen)
function csvRows(text, delim) {
    const rows = [];
    let cur = '', inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (ch === '"') { inQ = !inQ; cur += ch; continue; }
        if (!inQ && (ch === '\n')) { rows.push(cur.replace(/\r$/, '')); cur = ''; continue; }
        cur += ch;
    }
    if (cur.trim()) rows.push(cur);
    return rows;
}

const clean = (v) => { const s = String(v == null ? '' : v).trim(); return s === '-0-' ? '' : s; };

/* ─────────── parsers por fuente ─────────── */

function parseOfac(buf) {
    const out = [];
    for (const line of buf.toString('utf8').split('\n')) {
        if (!line.trim()) continue;
        const f = splitDelimited(line, ',');
        if (f.length < 4) continue;
        const name = clean(f[1]);
        if (normalizeName(name).length < 4) continue;
        out.push({ name, type: clean(f[2]) || 'entity', program: clean(f[3]), extra: null });
    }
    return out;
}

function parseUn(buf) {
    const xml = buf.toString('utf8');
    const out = [];
    const tag = (block, t) => {
        const m = block.match(new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>'));
        return m ? m[1].replace(/<[^>]+>/g, ' ').trim() : '';
    };
    ['INDIVIDUAL', 'ENTITY'].forEach((kind) => {
        const re = new RegExp('<' + kind + '>([\\s\\S]*?)</' + kind + '>', 'g');
        let m;
        while ((m = re.exec(xml)) !== null) {
            const b = m[1];
            const full = ['FIRST_NAME', 'SECOND_NAME', 'THIRD_NAME', 'FOURTH_NAME']
                .map((t) => tag(b, t)).filter(Boolean).join(' ');
            const program = tag(b, 'UN_LIST_TYPE') || 'ONU';
            const type = kind === 'INDIVIDUAL' ? 'individual' : 'entity';
            if (normalizeName(full).length >= 4) out.push({ name: full, type, program, extra: null });
            // alias
            const aliasRe = /<ALIAS_NAME>([\s\S]*?)<\/ALIAS_NAME>/g;
            let a;
            while ((a = aliasRe.exec(b)) !== null) {
                const al = a[1].replace(/<[^>]+>/g, ' ').trim();
                if (normalizeName(al).length >= 4) out.push({ name: al, type, program: program + ' (alias)', extra: null });
            }
        }
    });
    return out;
}

function parseUk(buf) {
    const rows = csvRows(buf.toString('utf8'), ',');
    // La primera línea es "Last Updated,fecha"; la cabecera real es la siguiente
    let headerIdx = rows.findIndex((r) => r.indexOf('Name 1') !== -1);
    if (headerIdx < 0) return [];
    const header = splitDelimited(rows[headerIdx], ',').map((h) => h.trim());
    const idx = (h) => header.indexOf(h);
    const nameCols = ['Name 1', 'Name 2', 'Name 3', 'Name 4', 'Name 5', 'Name 6'].map(idx);
    const iType = idx('Group Type'), iRegime = idx('Regime');
    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const f = splitDelimited(rows[i], ',');
        if (f.length < 5) continue;
        const name = nameCols.map((c) => (c >= 0 ? clean(f[c]) : '')).filter(Boolean).join(' ');
        if (normalizeName(name).length < 4) continue;
        out.push({
            name,
            type: (iType >= 0 ? clean(f[iType]) : '').toLowerCase() === 'individual' ? 'individual' : 'entity',
            program: iRegime >= 0 ? clean(f[iRegime]) : 'UK',
            extra: null
        });
    }
    return out;
}

function parseEu(buf) {
    const text = buf.toString('utf8').replace(/^﻿/, '');
    const rows = csvRows(text, ';');
    if (!rows.length) return [];
    const header = splitDelimited(rows[0], ';').map((h) => h.trim());
    const iWhole = header.indexOf('NameAlias_WholeName');
    const iLast = header.indexOf('NameAlias_LastName');
    const iFirst = header.indexOf('NameAlias_FirstName');
    const iType = header.indexOf('Entity_SubjectType_ClassificationCode');
    const iProg = header.indexOf('Entity_Regulation_Programme');
    const out = [];
    const seen = new Set();
    for (let i = 1; i < rows.length; i++) {
        const f = splitDelimited(rows[i], ';');
        if (f.length < 10) continue;
        let name = iWhole >= 0 ? clean(f[iWhole]) : '';
        if (!name) name = [iFirst >= 0 ? clean(f[iFirst]) : '', iLast >= 0 ? clean(f[iLast]) : ''].filter(Boolean).join(' ');
        const norm = normalizeName(name);
        if (norm.length < 4) continue;
        const prog = iProg >= 0 ? clean(f[iProg]) : 'UE';
        const key = norm + '|' + prog;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({
            name,
            type: (iType >= 0 ? clean(f[iType]) : '').toLowerCase() === 'person' ? 'individual' : 'entity',
            program: prog || 'UE',
            extra: null
        });
    }
    return out;
}

function parseSat69b(buf) {
    const text = buf.toString('latin1');
    const rows = csvRows(text, ',');
    const headerIdx = rows.findIndex((r) => r.indexOf('RFC') !== -1 && r.indexOf('Nombre del Contribuyente') !== -1);
    if (headerIdx < 0) return [];
    const header = splitDelimited(rows[headerIdx], ',').map((h) => h.trim());
    const iRfc = header.indexOf('RFC');
    const iName = header.indexOf('Nombre del Contribuyente');
    const iSit = header.indexOf('Situación del contribuyente');
    const out = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
        const f = splitDelimited(rows[i], ',');
        if (f.length < 4) continue;
        const situacion = clean(f[iSit]);
        // Solo presuntos y definitivos: quien se desvirtuó o ganó sentencia NO es señalado
        if (!/presunto|definitivo/i.test(situacion)) continue;
        const name = clean(f[iName]);
        const rfc = clean(f[iRfc]).toUpperCase();
        if (normalizeName(name).length < 4 && !rfc) continue;
        out.push({ name, type: 'entity', program: 'SAT 69-B — ' + situacion, extra: rfc || null });
    }
    return out;
}

const PARSERS = { ofac: parseOfac, un: parseUn, uk: parseUk, eu: parseEu, sat69b: parseSat69b };

/* ─────────── carga a Postgres ─────────── */

async function ensureSanctionsSchema(pool) {
    await ensureSchema();
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sanctions_entries (
            id BIGSERIAL PRIMARY KEY,
            list TEXT NOT NULL,
            name TEXT NOT NULL,
            norm TEXT NOT NULL,
            tokens TEXT[] NOT NULL,
            type TEXT,
            program TEXT,
            extra TEXT
        )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sanctions_tokens ON sanctions_entries USING GIN (tokens)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sanctions_list ON sanctions_entries (list)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_sanctions_extra ON sanctions_entries (extra) WHERE extra IS NOT NULL`);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sanctions_lists (
            list TEXT PRIMARY KEY,
            label TEXT NOT NULL,
            source_url TEXT,
            count INT NOT NULL DEFAULT 0,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            last_error TEXT
        )`);
}

async function refreshList(key, opts) {
    opts = opts || {};
    const src = SOURCES[key];
    if (!src) throw new Error('Lista desconocida: ' + key);
    const pool = getPool();
    if (!pool) throw new Error('DATABASE_URL no configurada');
    await ensureSanctionsSchema(pool);
    try {
        const buf = await fetchUrl(src.url, opts.timeoutMs || 120000);
        const parsed = PARSERS[src.parser](buf);
        if (!parsed.length) throw new Error('la fuente no devolvió registros');

        const rows = [];
        const seen = new Set();
        for (const e of parsed) {
            const norm = normalizeName(e.name);
            const tokens = tokenize(norm);
            if (!tokens.length && !e.extra) continue;
            const k = norm + '|' + (e.extra || '');
            if (seen.has(k)) continue;
            seen.add(k);
            rows.push([key, e.name, norm, tokens, e.type, e.program, e.extra]);
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query('DELETE FROM sanctions_entries WHERE list = $1', [key]);
            const B = 1000;
            for (let i = 0; i < rows.length; i += B) {
                const batch = rows.slice(i, i + B);
                // unnest aplana los arreglos anidados, así que los tokens viajan
                // como literales de arreglo de Postgres y se castean en el SELECT
                const arrayLit = (arr) => '{' + arr.map((t) => '"' + String(t).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"').join(',') + '}';
                await client.query(
                    `INSERT INTO sanctions_entries (list, name, norm, tokens, type, program, extra)
                     SELECT l, n, nm, tk::text[], ty, pr, ex
                     FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[], $7::text[])
                       AS t(l, n, nm, tk, ty, pr, ex)`,
                    [batch.map((r) => r[0]), batch.map((r) => r[1]), batch.map((r) => r[2]),
                     batch.map((r) => arrayLit(r[3])), batch.map((r) => r[4]), batch.map((r) => r[5]), batch.map((r) => r[6])]
                );
            }
            await client.query(
                `INSERT INTO sanctions_lists (list, label, source_url, count, updated_at, last_error)
                 VALUES ($1,$2,$3,$4,now(),NULL)
                 ON CONFLICT (list) DO UPDATE SET label=EXCLUDED.label, source_url=EXCLUDED.source_url,
                    count=EXCLUDED.count, updated_at=now(), last_error=NULL`,
                [key, src.label, src.url, rows.length]);
            await client.query('COMMIT');
        } catch (e) {
            await client.query('ROLLBACK').catch(() => {});
            throw e;
        } finally {
            client.release();
        }
        return { list: key, label: src.label, count: rows.length };
    } catch (e) {
        await pool.query(
            `INSERT INTO sanctions_lists (list, label, source_url, count, updated_at, last_error)
             VALUES ($1,$2,$3,0,now(),$4)
             ON CONFLICT (list) DO UPDATE SET last_error=EXCLUDED.last_error, updated_at=now()`,
            [key, src.label, src.url, e.message]).catch(() => {});
        throw e;
    }
}

async function listStatus() {
    const pool = getPool();
    if (!pool) return [];
    await ensureSanctionsSchema(pool);
    const r = await pool.query(
        `SELECT l.list, l.label, l.count, l.updated_at, l.last_error,
                (SELECT count(*)::int FROM sanctions_entries e WHERE e.list = l.list) AS indexed
         FROM sanctions_lists l ORDER BY l.list`);
    const known = new Set(r.rows.map((x) => x.list));
    const missing = Object.keys(SOURCES).filter((k) => !known.has(k))
        .map((k) => ({ list: k, label: SOURCES[k].label, count: 0, indexed: 0, updated_at: null, last_error: 'nunca descargada' }));
    return r.rows.concat(missing);
}

/* ─────────── screening ─────────── */

/**
 * Busca nombres (y opcionalmente RFC) contra todas las listas indexadas.
 * Nunca lanza: si no hay listas o falla la DB devuelve 'unavailable' para
 * que el caso pase a revisión manual en lugar de bloquear el onboarding.
 * @param {string[]} names
 * @param {{rfc?:string, loose?:boolean, limit?:number}} [opts]
 */
async function screenNames(names, opts) {
    opts = opts || {};
    if (process.env.SANCTIONS_SCREENING === 'off') {
        return { status: 'disabled', matches: [], lists: [] };
    }
    const pool = getPool();
    if (!pool) return { status: 'unavailable', error: 'sin base de datos', matches: [], lists: [] };

    const candidates = (names || []).filter(Boolean)
        .map((n) => ({ raw: n, norm: normalizeName(n) }))
        .filter((c) => c.norm.length >= 4);
    const rfc = opts.rfc ? String(opts.rfc).toUpperCase().replace(/[^A-Z0-9]/g, '') : null;
    if (!candidates.length && !rfc) return { status: 'skipped', matches: [], lists: [] };

    try {
        await ensureSanctionsSchema(pool);
        const total = await pool.query(
            `SELECT count(*)::int n, count(DISTINCT list)::int lists FROM sanctions_entries`);
        if (!total.rows[0].n) {
            return { status: 'unavailable', error: 'listas no descargadas', matches: [], lists: [] };
        }

        const matches = [];
        const ratio = opts.loose ? 0.5 : 0.75;
        for (const c of candidates) {
            const tokens = tokenize(c.norm);
            if (tokens.length < 2) continue;
            const need = Math.max(2, Math.ceil(tokens.length * ratio));
            const q = await pool.query(
                `SELECT list, name, type, program, extra, shared
                 FROM (
                   SELECT list, name, type, program, extra,
                          (SELECT count(*) FROM unnest(tokens) t WHERE t = ANY($1::text[])) AS shared
                   FROM sanctions_entries WHERE tokens && $1::text[]
                 ) s
                 WHERE shared >= $2
                 ORDER BY shared DESC
                 LIMIT $3`,
                [tokens, need, opts.limit || 10]);
            q.rows.forEach((m) => matches.push({
                query: c.raw, list: m.list, name: m.name, type: m.type,
                program: m.program, rfc: m.extra,
                shared: Number(m.shared), of: tokens.length
            }));
        }

        if (rfc && /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc)) {
            const q = await pool.query(
                `SELECT list, name, type, program, extra FROM sanctions_entries WHERE extra = $1 LIMIT 5`, [rfc]);
            q.rows.forEach((m) => matches.push({
                query: rfc, list: m.list, name: m.name, type: m.type,
                program: m.program, rfc: m.extra, shared: null, of: null, byRfc: true
            }));
        }

        return {
            status: matches.length ? 'hit' : 'clear',
            engine: 'listas-publicas',
            entriesSearched: total.rows[0].n,
            listsSearched: total.rows[0].lists,
            matches
        };
    } catch (e) {
        return { status: 'unavailable', error: e.message, matches: [], lists: [] };
    }
}

async function screenWithProvider() {
    if (!process.env.KYC_PROVIDER || !process.env.KYC_PROVIDER_KEY) return null;
    return { engine: process.env.KYC_PROVIDER, status: 'not_implemented' };
}

module.exports = {
    SOURCES, screenNames, screenWithProvider, normalizeName, tokenize,
    refreshList, listStatus, ensureSanctionsSchema,
    _parsers: PARSERS, _fetchUrl: fetchUrl
};
