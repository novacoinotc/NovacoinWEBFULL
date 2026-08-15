/*
 * POST /api/track — telemetría del onboarding para seguimiento de prospectos.
 * Registra sesiones (hasta qué paso llegó cada quien, qué datos y documentos
 * cargó) y eventos de comportamiento. Sin DATABASE_URL responde ok sin persistir.
 * Nunca recibe archivos ni documentos, solo metadatos.
 */
const { getPool, ensureSchema } = require('../lib/db.js');

const MAX_BODY = 64 * 1024;
const EVENTS = ['session_start', 'step_view', 'step_complete', 'doc_upload', 'doc_removed', 'submit_error', 'completed'];

function readBody(req) {
    if (req.body !== undefined) {
        return Promise.resolve(typeof req.body === 'string' ? JSON.parse(req.body) : req.body);
    }
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        req.on('data', (c) => {
            size += c.length;
            if (size > MAX_BODY) { reject(new Error('too_large')); req.destroy(); return; }
            chunks.push(c);
        });
        req.on('end', () => {
            try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
            catch (e) { reject(new Error('bad_json')); }
        });
        req.on('error', reject);
    });
}

const trim = (v, n) => (v == null ? null : String(v).slice(0, n));

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    if (req.method !== 'POST') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Método no permitido' })); }

    let b;
    try { b = await readBody(req); } catch (e) { res.statusCode = 400; return res.end(JSON.stringify({ error: e.message })); }
    if (!b || typeof b.sessionId !== 'string' || b.sessionId.length < 8 || b.sessionId.length > 64 ||
        EVENTS.indexOf(b.event) === -1) {
        res.statusCode = 422;
        return res.end(JSON.stringify({ error: 'Evento inválido' }));
    }

    let stored = false;
    const pool = getPool();
    if (pool) {
        try {
            await ensureSchema();
            const step = Number.isInteger(b.step) ? b.step : 0;
            const docs = Array.isArray(b.docs) ? b.docs.slice(0, 12).map((d) => trim(d, 30)) : [];
            await pool.query(
                `INSERT INTO onboarding_sessions (session_id, platforms, person_type, nombre, correo, telefono, max_step, docs, user_agent)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
                 ON CONFLICT (session_id) DO UPDATE SET
                    platforms = COALESCE(NULLIF(EXCLUDED.platforms, ''), onboarding_sessions.platforms),
                    person_type = COALESCE(EXCLUDED.person_type, onboarding_sessions.person_type),
                    nombre = COALESCE(EXCLUDED.nombre, onboarding_sessions.nombre),
                    correo = COALESCE(EXCLUDED.correo, onboarding_sessions.correo),
                    telefono = COALESCE(EXCLUDED.telefono, onboarding_sessions.telefono),
                    max_step = GREATEST(onboarding_sessions.max_step, EXCLUDED.max_step),
                    docs = EXCLUDED.docs,
                    updated_at = now()`,
                [trim(b.sessionId, 64),
                 (Array.isArray(b.platforms) ? b.platforms : []).join(','),
                 trim(b.personType, 10),
                 trim(b.nombre, 120) || null,
                 trim(b.correo, 120) || null,
                 trim(b.telefono, 20) || null,
                 Math.max(0, Math.min(step, 20)),
                 JSON.stringify(docs),
                 trim(req.headers['user-agent'], 300)]
            );
            await pool.query(
                `INSERT INTO onboarding_events (session_id, event, step, meta) VALUES ($1,$2,$3,$4)`,
                [trim(b.sessionId, 64), b.event, step, JSON.stringify(b.meta || {})]
            );
            stored = true;
        } catch (e) {
            console.error('track error:', e.message);
        }
    }
    res.statusCode = 200;
    return res.end(JSON.stringify({ ok: true, stored }));
};
