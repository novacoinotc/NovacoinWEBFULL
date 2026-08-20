/*
 * /api/admin — API del dashboard interno de prospectos y expedientes.
 * Protegido con ADMIN_KEY (query ?key=, header x-admin-key o Bearer).
 *
 *   GET  /api/admin                     → resumen: funnel, sesiones, solicitudes
 *   GET  /api/admin?folio=NC-...        → expediente completo (sin binarios)
 *   GET  /api/admin?folio=NC-...&doc=k  → documento binario (imagen o PDF)
 *   POST /api/admin {action, folio, reason} → aprobar / rechazar / reabrir
 */
const { getPool, ensureSchema } = require('../lib/db.js');

const ACTIONS = { approve: 'approved', reject: 'rejected', reopen: 'pending_review' };

function extractKey(req) {
    const url = new URL(req.url, 'http://x');
    return url.searchParams.get('key') ||
        req.headers['x-admin-key'] ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '';
}

function readBody(req) {
    if (req.body !== undefined) {
        return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    }
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on('data', (c) => {
            size += c.length;
            if (size > 32 * 1024) { reject(new Error('too_large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(new Error('bad_json')); }
        });
        req.on('error', reject);
    });
}

function json(res, code, obj) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.statusCode = code;
    return res.end(JSON.stringify(obj));
}

async function serveDocument(res, pool, folio, docKey) {
    const r = await pool.query(
        `SELECT payload->'documents'->$2 AS doc FROM onboarding_requests WHERE folio = $1`, [folio, docKey]);
    const doc = r.rows.length ? r.rows[0].doc : null;
    if (!doc || !doc.dataUrl) return json(res, 404, { error: 'Documento no encontrado' });
    const m = String(doc.dataUrl).match(/^data:(.+?);base64,(.*)$/);
    if (!m) return json(res, 500, { error: 'Documento corrupto' });
    res.setHeader('Content-Type', m[1]);
    res.setHeader('Content-Disposition', 'inline; filename="' + folio + '-' + docKey + (m[1].includes('pdf') ? '.pdf' : '.jpg') + '"');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.statusCode = 200;
    return res.end(Buffer.from(m[2], 'base64'));
}

async function serveDetail(res, pool, folio) {
    const r = await pool.query(
        `SELECT folio, platform, person_type, risk_level, status, created_at, payload
         FROM onboarding_requests WHERE folio = $1`, [folio]);
    if (!r.rows.length) return json(res, 404, { error: 'Expediente no encontrado' });
    const row = r.rows[0];
    const p = row.payload || {};
    const docs = {};
    Object.entries(p.documents || {}).forEach(([k, d]) => {
        if (d && d.dataUrl) docs[k] = { name: d.name || k, isPdf: !!d.isPdf };
    });
    return json(res, 200, {
        ok: true,
        folio: row.folio,
        platform: row.platform,
        personType: row.person_type,
        riskLevel: row.risk_level,
        status: row.status,
        createdAt: row.created_at,
        general: p.general || null,
        contact: p.contact || null,
        address: p.address || null,
        fiscal: p.fiscal || null,
        amlProfile: p.amlProfile || null,
        references: p.references || [],
        checks: p.checks || null,
        serverRisk: p.serverRisk || null,
        sanctionsScreening: p.sanctionsScreening || null,
        consent: p.consent || null,
        review: p.review || null,
        documents: docs
    });
}

module.exports = async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');

    if (!process.env.ADMIN_KEY) return json(res, 503, { error: 'ADMIN_KEY no configurada en el servidor' });
    if (extractKey(req) !== process.env.ADMIN_KEY) return json(res, 401, { error: 'Clave inválida' });

    const pool = getPool();

    if (req.method === 'POST') {
        let b;
        try { b = await readBody(req); } catch (e) { return json(res, 400, { error: e.message }); }
        const status = ACTIONS[b && b.action];
        if (!status || !b.folio) return json(res, 422, { error: 'Acción o folio inválidos' });
        if (!pool) return json(res, 503, { error: 'Base de datos no configurada' });
        try {
            await ensureSchema();
            const review = { action: b.action, status, reason: String(b.reason || '').slice(0, 500) || null, at: new Date().toISOString() };
            const r = await pool.query(
                `UPDATE onboarding_requests
                 SET status = $2, payload = jsonb_set(payload, '{review}', $3::jsonb)
                 WHERE folio = $1 RETURNING folio, status`,
                [b.folio, status, JSON.stringify(review)]);
            if (!r.rows.length) return json(res, 404, { error: 'Expediente no encontrado' });
            // refleja el estatus también en la sesión del prospecto
            await pool.query(`UPDATE onboarding_sessions SET updated_at = now() WHERE folio = $1`, [b.folio]).catch(() => {});
            return json(res, 200, { ok: true, folio: r.rows[0].folio, status: r.rows[0].status, review });
        } catch (e) {
            console.error('admin action error:', e.message);
            return json(res, 500, { error: 'Error actualizando: ' + e.message });
        }
    }

    if (req.method !== 'GET') return json(res, 405, { error: 'Método no permitido' });

    const url = new URL(req.url, 'http://x');
    const folio = url.searchParams.get('folio');
    const doc = url.searchParams.get('doc');

    if (folio && !pool) return json(res, 503, { error: 'Base de datos no configurada' });

    try {
        if (folio) {
            await ensureSchema();
            if (doc) return await serveDocument(res, pool, folio, doc);
            return await serveDetail(res, pool, folio);
        }

        if (!pool) {
            return json(res, 200, { ok: true, dbConfigured: false, sessions: [], requests: [], funnel: [], stats: {} });
        }
        await ensureSchema();
        const [sessions, requests, funnel, events] = await Promise.all([
            pool.query(`SELECT session_id, platforms, person_type, nombre, correo, telefono, max_step, docs,
                               completed, folio, risk_level, created_at, updated_at
                        FROM onboarding_sessions ORDER BY updated_at DESC LIMIT 300`),
            pool.query(`SELECT folio, platform, person_type, nombre, correo, telefono, rfc, risk_level, status, created_at
                        FROM onboarding_requests ORDER BY created_at DESC LIMIT 200`),
            pool.query(`SELECT max_step, COUNT(*)::int AS n FROM onboarding_sessions GROUP BY max_step ORDER BY max_step`),
            pool.query(`SELECT event, COUNT(*)::int AS n FROM onboarding_events GROUP BY event`)
        ]);
        const stats = {
            totalSessions: sessions.rows.length,
            completed: sessions.rows.filter((s) => s.completed).length,
            abandoned: sessions.rows.filter((s) => !s.completed).length,
            withContact: sessions.rows.filter((s) => !s.completed && (s.correo || s.telefono)).length,
            totalRequests: requests.rows.length,
            pending: requests.rows.filter((r) => r.status === 'pending_review').length,
            approved: requests.rows.filter((r) => r.status === 'approved').length,
            rejected: requests.rows.filter((r) => r.status === 'rejected').length,
            highRisk: requests.rows.filter((r) => r.risk_level === 'alto').length
        };
        return json(res, 200, {
            ok: true, dbConfigured: true, stats,
            funnel: funnel.rows, eventCounts: events.rows,
            sessions: sessions.rows, requests: requests.rows
        });
    } catch (e) {
        console.error('admin error:', e.message);
        return json(res, 500, { error: 'Error consultando la base de datos: ' + e.message });
    }
};
