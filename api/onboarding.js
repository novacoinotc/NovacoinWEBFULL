/*
 * POST /api/onboarding — recibe solicitudes de onboarding KYC.
 * Corre como función de Vercel y también bajo el server Node de pruebas (server.js).
 * Si DATABASE_URL está definida (Postgres), persiste en la tabla onboarding_requests;
 * si no, responde ok con stored:false para que el equipo la reciba por otro canal.
 */
const validators = require('../onboarding/validators.js');
const { getPool, ensureSchema } = require('../lib/db.js');
const sanctions = require('../lib/sanctions.js');

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
    const platforms = Array.isArray(p.platforms) ? p.platforms : [];
    if (!platforms.length || platforms.some((x) => PLATFORMS.indexOf(x) === -1)) {
        errors.push('Selecciona al menos una plataforma válida');
    }
    if (['fisica', 'moral'].indexOf(p.personType) === -1) errors.push('Tipo de persona inválido');

    const g = p.general || {};
    if (!validators.validateName(g.nombre).valid) errors.push('Nombre inválido');
    if (!validators.validateName(g.apellidoPaterno).valid) errors.push('Apellido paterno inválido');
    if (p.personType === 'moral' && !(g.razonSocial || '').trim()) errors.push('Razón social requerida');
    if (platforms.indexOf('novapay') !== -1 && !(g.negocio && (g.negocio.nombreComercial || '').trim())) {
        errors.push('NovaPay requiere los datos del negocio');
    }

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

    const aml = p.amlProfile || {};
    ['origenRecursos', 'sectorEconomico', 'usoCuenta', 'montoMensual', 'opsMensuales'].forEach((k) => {
        if (!(aml[k] || '').trim()) errors.push('Perfil transaccional incompleto: ' + k);
    });
    ['pepSelf', 'pepFamily', 'cuentaPropia', 'residenciaExtranjera'].forEach((k) => {
        if (typeof aml[k] !== 'boolean') errors.push('Declaración AML faltante: ' + k);
    });
    if (aml.pepSelf === true && !(aml.pepCargo || '').trim()) errors.push('Falta el cargo de la PEP');
    if (aml.pepFamily === true && !(aml.pepFamiliarDetalle || '').trim()) errors.push('Falta el detalle del familiar PEP');
    if (aml.cuentaPropia === false && !(aml.beneficiario && (aml.beneficiario.nombre || '').trim())) {
        errors.push('Falta el beneficiario controlador');
    }
    if (aml.residenciaExtranjera === true && !(aml.paisResidencia || '').trim()) {
        errors.push('Falta el país de residencia fiscal');
    }

    if (!Array.isArray(p.references) || p.references.length < 2) errors.push('Se requieren 2 referencias');
    else p.references.forEach((r, i) => {
        if (!validators.validateName(r.nombre).valid || !validators.validatePhone(r.telefono).valid) {
            errors.push('Referencia ' + (i + 1) + ' inválida');
        }
    });

    const d = p.documents || {};
    const requiredDocs = ['comprobante', 'ingresos', 'ineFrente', 'ineReverso', 'selfie'];
    if (p.personType === 'moral') requiredDocs.push('actaConstitutiva', 'csf');
    requiredDocs.forEach((k) => {
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
    const pool = getPool();
    if (!pool) return false;
    await ensureSchema();
    const g = payload.general || {};
    await pool.query(
        `INSERT INTO onboarding_requests (folio, platform, person_type, nombre, correo, telefono, rfc, risk_level, payload)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [folio, (payload.platforms || []).join(','), payload.personType,
         [g.nombre, g.apellidoPaterno, g.apellidoMaterno].filter(Boolean).join(' '),
         (payload.contact || {}).correo, (payload.contact || {}).telefono,
         (payload.fiscal || {}).rfc,
         ((payload.serverRisk || {}).level) || null,
         JSON.stringify(payload)]
    );
    // marca la sesión del prospecto como completada para el dashboard
    if (payload.sessionId) {
        await pool.query(
            `UPDATE onboarding_sessions SET completed = true, folio = $2,
                    risk_level = $3, updated_at = now()
             WHERE session_id = $1`,
            [String(payload.sessionId).slice(0, 64), folio, (payload.serverRisk || {}).level || null]
        ).catch(() => {});
    }
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

    // Screening contra listas públicas de sanciones (OFAC SDN) — motor propio.
    // Un hit no rechaza automáticamente: eleva el riesgo y va a revisión manual.
    const gg = payload.general || {};
    const namesToScreen = [
        [gg.nombre, gg.apellidoPaterno, gg.apellidoMaterno].filter(Boolean).join(' '),
        gg.razonSocial,
        payload.amlProfile && payload.amlProfile.beneficiario ? payload.amlProfile.beneficiario.nombre : null
    ];
    payload.sanctionsScreening = await sanctions.screenNames(namesToScreen);

    // Scoring de riesgo del lado del servidor (independiente del cliente)
    const aml = payload.amlProfile || {};
    payload.serverRisk = validators.computeRiskScore({
        pepSelf: aml.pepSelf,
        pepFamily: aml.pepFamily,
        foreignTaxResidency: aml.residenciaExtranjera,
        sector: aml.sectorEconomico,
        monthlyVolume: aml.montoMensual,
        sourceOfFunds: aml.origenRecursos,
        thirdParty: aml.cuentaPropia === false,
        personType: payload.personType
    });
    if (payload.sanctionsScreening.status === 'hit') {
        payload.serverRisk.score += 60;
        payload.serverRisk.level = 'alto';
        payload.serverRisk.reasons.push('Posible coincidencia en lista OFAC — verificar manualmente');
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
    return res.end(JSON.stringify({ ok: true, folio, stored, riskLevel: payload.serverRisk.level }));
};
