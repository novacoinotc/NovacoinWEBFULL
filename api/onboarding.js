/*
 * POST /api/onboarding — recibe solicitudes de onboarding KYC.
 * Corre como función de Vercel y también bajo el server Node de pruebas (server.js).
 * Si DATABASE_URL está definida (Postgres), persiste en la tabla onboarding_requests;
 * si no, responde ok con stored:false para que el equipo la reciba por otro canal.
 */
const validators = require('../onboarding/validators.js');

const MAX_BODY_BYTES = 4.4 * 1024 * 1024;
const PLATFORMS = ['novacore', 'rfq', 'novapay'];

function readBody(req) {
    // Vercel ya entrega req.body; en Node puro hay que juntar el stream
    if (req.body !== undefined) return Promise.resolve(req.body);
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY_BYTES) { reject(new Error('PAYLOAD_TOO_LARGE')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(new Error('BAD_JSON')); }
        });
        req.on('error', reject);
    });
}

function validatePayload(p) {
    const errors = [];
    if (!p || typeof p !== 'object') return ['Cuerpo inválido'];
    if (PLATFORMS.indexOf(p.platform) === -1) errors.push('Plataforma inválida');
    if (['fisica', 'moral'].indexOf(p.personType) === -1) errors.push('Tipo de persona inválido');

    const g = p.general || {};
    if (!validators.validateName(g.nombre).valid) errors.push('Nombre inválido');
    if (!validators.validateName(g.apellidoPaterno).valid) errors.push('Apellido paterno inválido');
    if (p.personType === 'moral' && !(g.razonSocial || '').trim()) errors.push('Razón social requerida');

    const c = p.contact || {};
    if (!validators.validatePhone(c.telefono).valid) errors.push('Teléfono inválido');
    if (!validators.validateEmail(c.correo).valid) errors.push('Correo inválido');

    const a = p.address || {};
    ['calle', 'numExt', 'colonia', 'ciudad', 'estado'].forEach((k) => {
        if (!(a[k] || '').trim()) errors.push('Domicilio incompleto: ' + k);
    });
    if (!validators.validateCP(a.cp).valid) errors.push('Código postal inválido');

    const f = p.fiscal || {};
    const rfc = validators.validateRFC(f.rfc);
    if (!rfc.valid) errors.push('RFC inválido: ' + rfc.errors.join(', '));
    if (p.personType === 'fisica') {
        const curp = validators.validateCURP(f.curp);
        if (!curp.valid) errors.push('CURP inválida');
        else if (rfc.valid && !validators.crossCheckRfcCurp(f.rfc, f.curp).valid) errors.push('RFC y CURP no coinciden');
    }
    if (f.clabe && !validators.validateCLABE(f.clabe).valid) errors.push('CLABE inválida');

    if (!Array.isArray(p.references) || p.references.length < 2) errors.push('Se requieren 2 referencias');
    else p.references.forEach((r, i) => {
        if (!validators.validateName(r.nombre).valid || !validators.validatePhone(r.telefono).valid) {
            errors.push('Referencia ' + (i + 1) + ' inválida');
        }
    });

    const d = p.documents || {};
    ['comprobante', 'ineFrente', 'ineReverso', 'selfie'].forEach((k) => {
        if (!d[k] || !d[k].dataUrl) errors.push('Documento faltante: ' + k);
    });

    if (!p.consent || p.consent.privacy !== true || p.consent.truth !== true) {
        errors.push('Consentimiento requerido');
    }
    return errors;
}

function makeFolio() {
    const t = Date.now().toString(36).toUpperCase();
    const r = Math.random().toString(36).slice(2, 6).toUpperCase();
    return 'NC-' + t + '-' + r;
}

async function persist(folio, payload) {
    if (!process.env.DATABASE_URL) return false;
    // Conexión perezosa: pg solo se carga si hay base de datos configurada
    const { Pool } = require('pg');
    if (!persist._pool) {
        persist._pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 3,
            ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
        });
    }
    const pool = persist._pool;
    await pool.query(`
        CREATE TABLE IF NOT EXISTS onboarding_requests (
            id BIGSERIAL PRIMARY KEY,
            folio TEXT UNIQUE NOT NULL,
            platform TEXT NOT NULL,
            person_type TEXT NOT NULL,
            nombre TEXT, correo TEXT, telefono TEXT, rfc TEXT,
            status TEXT NOT NULL DEFAULT 'pending_review',
            payload JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )`);
    const g = payload.general || {};
    await pool.query(
        `INSERT INTO onboarding_requests (folio, platform, person_type, nombre, correo, telefono, rfc, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [folio, payload.platform, payload.personType,
         [g.nombre, g.apellidoPaterno, g.apellidoMaterno].filter(Boolean).join(' '),
         (payload.contact || {}).correo, (payload.contact || {}).telefono,
         (payload.fiscal || {}).rfc, JSON.stringify(payload)]
    );
    return true;
}

module.exports = async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
    if (req.method !== 'POST') {
        res.statusCode = 405;
        return res.end(JSON.stringify({ error: 'Método no permitido' }));
    }
    res.setHeader('Content-Type', 'application/json; charset=utf-8');

    let payload;
    try {
        payload = await readBody(req);
    } catch (e) {
        res.statusCode = e.message === 'PAYLOAD_TOO_LARGE' ? 413 : 400;
        return res.end(JSON.stringify({ error: e.message === 'PAYLOAD_TOO_LARGE' ? 'Los documentos pesan demasiado' : 'JSON inválido' }));
    }

    const errors = validatePayload(payload);
    if (errors.length) {
        res.statusCode = 422;
        return res.end(JSON.stringify({ error: 'Datos inválidos', details: errors }));
    }

    const folio = makeFolio();
    let stored = false;
    try {
        stored = await persist(folio, payload);
    } catch (e) {
        // La DB falló: no perdemos la solicitud, se reporta stored:false y queda en logs
        console.error('onboarding persist error:', e.message);
    }

    res.statusCode = 201;
    return res.end(JSON.stringify({ ok: true, folio, stored }));
};
