/*
 * GET /api/admin — datos para el dashboard interno de prospectos.
 * Protegido con ADMIN_KEY (query ?key=, header x-admin-key o Bearer).
 * Devuelve funnel por paso, sesiones recientes (prospectos) y solicitudes.
 */
const { getPool, ensureSchema } = require('../lib/db.js');

function extractKey(req) {
    const url = new URL(req.url, 'http://x');
    return url.searchParams.get('key') ||
        req.headers['x-admin-key'] ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || '';
}

module.exports = async function handler(req, res) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET') { res.statusCode = 405; return res.end(JSON.stringify({ error: 'Método no permitido' })); }

    if (!process.env.ADMIN_KEY) {
        res.statusCode = 503;
        return res.end(JSON.stringify({ error: 'ADMIN_KEY no configurada en el servidor' }));
    }
    if (extractKey(req) !== process.env.ADMIN_KEY) {
        res.statusCode = 401;
        return res.end(JSON.stringify({ error: 'Clave inválida' }));
    }

    const pool = getPool();
    if (!pool) {
        res.statusCode = 200;
        return res.end(JSON.stringify({ ok: true, dbConfigured: false, sessions: [], requests: [], funnel: [], stats: {} }));
    }

    try {
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
            highRisk: requests.rows.filter((r) => r.risk_level === 'alto').length
        };
        res.statusCode = 200;
        return res.end(JSON.stringify({
            ok: true, dbConfigured: true,
            stats,
            funnel: funnel.rows,
            eventCounts: events.rows,
            sessions: sessions.rows,
            requests: requests.rows
        }));
    } catch (e) {
        console.error('admin error:', e.message);
        res.statusCode = 500;
        return res.end(JSON.stringify({ error: 'Error consultando la base de datos: ' + e.message }));
    }
};
