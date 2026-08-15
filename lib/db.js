/*
 * Capa de base de datos compartida (Neon Postgres).
 * Si DATABASE_URL no está definida, getPool() devuelve null y los endpoints
 * degradan a "sin persistencia" sin romper la experiencia del usuario.
 */
const { Pool } = require('pg');

let pool = null;
let schemaReady = null;

function getPool() {
    if (!process.env.DATABASE_URL) return null;
    if (!pool) {
        pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            max: 3,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 8000,
            ssl: { rejectUnauthorized: false }
        });
    }
    return pool;
}

async function ensureSchema() {
    const p = getPool();
    if (!p) return null;
    if (!schemaReady) {
        schemaReady = (async () => {
            await p.query(`
                CREATE TABLE IF NOT EXISTS onboarding_requests (
                    id BIGSERIAL PRIMARY KEY,
                    folio TEXT UNIQUE NOT NULL,
                    platform TEXT NOT NULL,
                    person_type TEXT NOT NULL,
                    nombre TEXT, correo TEXT, telefono TEXT, rfc TEXT,
                    risk_level TEXT,
                    status TEXT NOT NULL DEFAULT 'pending_review',
                    payload JSONB NOT NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`);
            await p.query(`
                CREATE TABLE IF NOT EXISTS onboarding_sessions (
                    session_id TEXT PRIMARY KEY,
                    platforms TEXT,
                    person_type TEXT,
                    nombre TEXT, correo TEXT, telefono TEXT,
                    max_step INT NOT NULL DEFAULT 0,
                    docs JSONB NOT NULL DEFAULT '[]',
                    completed BOOLEAN NOT NULL DEFAULT false,
                    folio TEXT,
                    risk_level TEXT,
                    user_agent TEXT,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`);
            await p.query(`
                CREATE TABLE IF NOT EXISTS onboarding_events (
                    id BIGSERIAL PRIMARY KEY,
                    session_id TEXT,
                    event TEXT NOT NULL,
                    step INT,
                    meta JSONB,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`);
            await p.query(`
                CREATE TABLE IF NOT EXISTS kv_cache (
                    key TEXT PRIMARY KEY,
                    value JSONB NOT NULL,
                    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
                )`);
            await p.query(`CREATE INDEX IF NOT EXISTS idx_events_session ON onboarding_events (session_id, created_at)`);
            await p.query(`CREATE INDEX IF NOT EXISTS idx_sessions_updated ON onboarding_sessions (updated_at DESC)`);
        })().catch((e) => { schemaReady = null; throw e; });
    }
    return schemaReady;
}

module.exports = { getPool, ensureSchema };
