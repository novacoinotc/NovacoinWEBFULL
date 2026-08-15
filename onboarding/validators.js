/*
 * NovaCoin — Motor de validación de datos KYC
 * Validadores puros (sin DOM) para RFC, CURP, CLABE, teléfono, correo,
 * código postal, nombres y archivos. Usable en navegador y en Node (tests).
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) {
        module.exports = factory();
    } else {
        root.NovaValidators = factory();
    }
})(typeof self !== 'undefined' ? self : this, function () {
    'use strict';

    /* ---------- RFC (SAT, Anexo 3) ---------- */
    // Tabla de valores oficial del SAT para el dígito verificador
    var RFC_ALPHABET = '0123456789ABCDEFGHIJKLMN&OPQRSTUVWXYZ Ñ';
    var RFC_REGEX = /^([A-ZÑ&]{3,4})(\d{2})(\d{2})(\d{2})([A-Z\d]{2})([A-Z\d])$/;
    // Palabras inconvenientes que el SAT sustituye — un RFC real nunca las contiene
    var RFC_BLACKLIST = ['BUEI', 'BUEY', 'CACA', 'CACO', 'CAGA', 'CAGO', 'CAKA', 'CAKO', 'COGE', 'COJA', 'COJE', 'COJI', 'COJO', 'CULO', 'FETO', 'GUEY', 'JOTO', 'KACA', 'KACO', 'KAGA', 'KAGO', 'KOGE', 'KOJO', 'KAKA', 'KULO', 'MAME', 'MAMO', 'MEAR', 'MEAS', 'MEON', 'MION', 'MOCO', 'MULA', 'PEDA', 'PEDO', 'PENE', 'PUTA', 'PUTO', 'QULO', 'RATA', 'RUIN'];

    function normalizeRfc(rfc) {
        return String(rfc || '').trim().toUpperCase().replace(/[\s-]/g, '');
    }

    function rfcCheckDigit(rfc12) {
        // rfc12: los primeros 12 caracteres de un RFC de 13 (o ' ' + RFC de 11 para morales)
        var str = rfc12.length === 11 ? ' ' + rfc12 : rfc12;
        var sum = 0;
        for (var i = 0; i < 12; i++) {
            var idx = RFC_ALPHABET.indexOf(str.charAt(i));
            if (idx < 0) return null;
            sum += idx * (13 - i);
        }
        var mod = sum % 11;
        if (mod === 0) return '0';
        var digit = 11 - mod;
        if (digit === 10) return 'A';
        return String(digit);
    }

    function validateRFC(input) {
        var rfc = normalizeRfc(input);
        var result = { value: rfc, valid: false, type: null, errors: [] };
        if (!rfc) { result.errors.push('RFC vacío'); return result; }
        if (rfc.length !== 12 && rfc.length !== 13) {
            result.errors.push('El RFC debe tener 12 (persona moral) o 13 (persona física) caracteres');
            return result;
        }
        result.type = rfc.length === 13 ? 'fisica' : 'moral';
        var body = rfc.length === 13 ? rfc : ' ' + rfc; // normaliza a 13 posiciones
        if (!RFC_REGEX.test(rfc.length === 13 ? rfc : 'X' + rfc) && !RFC_REGEX.test(rfc)) {
            // Para morales el regex admite 3 letras iniciales
            if (!/^[A-ZÑ&]{3}\d{6}[A-Z\d]{3}$/.test(rfc) && !/^[A-ZÑ&]{4}\d{6}[A-Z\d]{3}$/.test(rfc)) {
                result.errors.push('Formato de RFC inválido');
                return result;
            }
        }
        if (result.type === 'fisica' && RFC_BLACKLIST.indexOf(rfc.slice(0, 4)) !== -1) {
            result.errors.push('RFC con palabra no permitida por el SAT');
            return result;
        }
        // Fecha embebida (AAMMDD)
        var dateStart = result.type === 'fisica' ? 4 : 3;
        var mm = parseInt(rfc.substr(dateStart + 2, 2), 10);
        var dd = parseInt(rfc.substr(dateStart + 4, 2), 10);
        if (mm < 1 || mm > 12 || dd < 1 || dd > 31) {
            result.errors.push('La fecha dentro del RFC no es válida');
            return result;
        }
        // Dígito verificador
        var expected = rfcCheckDigit(rfc.slice(0, rfc.length - 1));
        if (expected === null) {
            result.errors.push('Caracteres inválidos en el RFC');
            return result;
        }
        if (expected !== rfc.charAt(rfc.length - 1)) {
            result.errors.push('Dígito verificador incorrecto — revisa que el RFC esté bien escrito');
            return result;
        }
        result.valid = true;
        return result;
    }

    /* ---------- CURP ---------- */
    var CURP_REGEX = /^[A-Z][AEIOUX][A-Z]{2}\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])[HM](AS|BC|BS|CC|CL|CM|CS|CH|DF|DG|GT|GR|HG|JC|MC|MN|MS|NT|NL|OC|PL|QT|QR|SP|SL|SR|TC|TS|TL|VZ|YN|ZS|NE)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d$/;
    var CURP_ALPHABET = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';

    function validateCURP(input) {
        var curp = String(input || '').trim().toUpperCase();
        var result = { value: curp, valid: false, errors: [] };
        if (!curp) { result.errors.push('CURP vacía'); return result; }
        if (curp.length !== 18) { result.errors.push('La CURP debe tener 18 caracteres'); return result; }
        if (!CURP_REGEX.test(curp)) { result.errors.push('Formato de CURP inválido'); return result; }
        var sum = 0;
        for (var i = 0; i < 17; i++) {
            sum += CURP_ALPHABET.indexOf(curp.charAt(i)) * (18 - i);
        }
        var digit = (10 - (sum % 10)) % 10;
        if (digit !== parseInt(curp.charAt(17), 10)) {
            result.errors.push('Dígito verificador de CURP incorrecto');
            return result;
        }
        result.valid = true;
        return result;
    }

    /* ---------- CLABE interbancaria ---------- */
    function validateCLABE(input) {
        var clabe = String(input || '').replace(/[\s-]/g, '');
        var result = { value: clabe, valid: false, errors: [] };
        if (!/^\d{18}$/.test(clabe)) { result.errors.push('La CLABE debe tener 18 dígitos'); return result; }
        var weights = [3, 7, 1];
        var sum = 0;
        for (var i = 0; i < 17; i++) {
            sum += (parseInt(clabe.charAt(i), 10) * weights[i % 3]) % 10;
        }
        var control = (10 - (sum % 10)) % 10;
        if (control !== parseInt(clabe.charAt(17), 10)) {
            result.errors.push('Dígito de control de CLABE incorrecto');
            return result;
        }
        result.valid = true;
        return result;
    }

    /* ---------- Teléfono (México) ---------- */
    function validatePhone(input) {
        var raw = String(input || '').trim();
        var digits = raw.replace(/[\s().+-]/g, '');
        var result = { value: digits, valid: false, errors: [] };
        if (/^52\d{10}$/.test(digits)) digits = digits.slice(2);
        if (/^521\d{10}$/.test(digits)) digits = digits.slice(3);
        if (!/^\d{10}$/.test(digits)) {
            result.errors.push('Ingresa un teléfono mexicano de 10 dígitos');
            return result;
        }
        if (/^(\d)\1{9}$/.test(digits)) {
            result.errors.push('El teléfono no parece real');
            return result;
        }
        result.value = digits;
        result.e164 = '+52' + digits;
        result.valid = true;
        return result;
    }

    /* ---------- Correo electrónico ---------- */
    var EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    var COMMON_TYPOS = { 'gmail.co': 'gmail.com', 'gmail.con': 'gmail.com', 'gmial.com': 'gmail.com', 'hotmail.co': 'hotmail.com', 'hotmial.com': 'hotmail.com', 'outlook.co': 'outlook.com', 'yahoo.co': 'yahoo.com.mx' };

    function validateEmail(input) {
        var email = String(input || '').trim().toLowerCase();
        var result = { value: email, valid: false, errors: [], suggestion: null };
        if (!EMAIL_REGEX.test(email)) {
            result.errors.push('Correo electrónico inválido');
            return result;
        }
        var domain = email.split('@')[1];
        if (COMMON_TYPOS[domain]) {
            result.suggestion = email.split('@')[0] + '@' + COMMON_TYPOS[domain];
        }
        result.valid = true;
        return result;
    }

    /* ---------- Código postal (México) ---------- */
    function validateCP(input) {
        var cp = String(input || '').trim();
        var result = { value: cp, valid: /^\d{5}$/.test(cp), errors: [] };
        if (!result.valid) result.errors.push('El código postal debe tener 5 dígitos');
        return result;
    }

    /* ---------- Nombre ---------- */
    function validateName(input) {
        var name = String(input || '').trim().replace(/\s+/g, ' ');
        var result = { value: name, valid: false, errors: [] };
        if (name.length < 2) { result.errors.push('Nombre demasiado corto'); return result; }
        if (!/^[A-Za-zÁÉÍÓÚÜÑáéíóúüñ'.\- ]+$/.test(name)) {
            result.errors.push('El nombre solo puede contener letras');
            return result;
        }
        result.valid = true;
        return result;
    }

    /* ---------- Fecha de nacimiento (mayoría de edad) ---------- */
    function validateBirthdate(input, now) {
        var result = { value: input, valid: false, errors: [], age: null };
        var d = new Date(input);
        if (isNaN(d.getTime())) { result.errors.push('Fecha inválida'); return result; }
        var ref = now ? new Date(now) : new Date();
        var age = ref.getFullYear() - d.getFullYear();
        var m = ref.getMonth() - d.getMonth();
        if (m < 0 || (m === 0 && ref.getDate() < d.getDate())) age--;
        result.age = age;
        if (age < 18) { result.errors.push('Debes ser mayor de 18 años'); return result; }
        if (age > 120) { result.errors.push('Fecha de nacimiento inválida'); return result; }
        result.valid = true;
        return result;
    }

    /* ---------- Congruencia RFC / CURP / fecha ---------- */
    function crossCheckRfcCurp(rfc, curp) {
        // La fecha AAMMDD y las 4 letras iniciales deben coincidir entre RFC físico y CURP
        var result = { valid: true, errors: [] };
        var r = normalizeRfc(rfc);
        var c = String(curp || '').trim().toUpperCase();
        if (r.length !== 13 || c.length !== 18) return result; // solo aplica a persona física con ambos datos
        if (r.slice(0, 4) !== c.slice(0, 4)) {
            result.valid = false;
            result.errors.push('Las iniciales del RFC y la CURP no coinciden');
        }
        if (r.slice(4, 10) !== c.slice(4, 10)) {
            result.valid = false;
            result.errors.push('La fecha de nacimiento del RFC y la CURP no coinciden');
        }
        return result;
    }

    /* ---------- Archivos (comprobantes / identificaciones) ---------- */
    var ALLOWED_DOC_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    var ALLOWED_IMG_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
    var MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB antes de compresión

    function validateFile(file, opts) {
        opts = opts || {};
        var allowed = opts.imagesOnly ? ALLOWED_IMG_TYPES : ALLOWED_DOC_TYPES;
        var result = { valid: false, errors: [] };
        if (!file) { result.errors.push('Selecciona un archivo'); return result; }
        if (allowed.indexOf(file.type) === -1) {
            result.errors.push(opts.imagesOnly ? 'Solo se aceptan imágenes JPG, PNG o WebP' : 'Solo se aceptan JPG, PNG, WebP o PDF');
            return result;
        }
        if (file.size > MAX_FILE_BYTES) {
            result.errors.push('El archivo supera 10 MB');
            return result;
        }
        if (file.size < 5 * 1024) {
            result.errors.push('El archivo es demasiado pequeño para ser un documento legible');
            return result;
        }
        result.valid = true;
        return result;
    }

    /* ---------- Detección de texto INE en OCR ---------- */
    function analyzeIneText(text) {
        // Busca marcadores típicos de la credencial INE/IFE en texto OCR
        var t = String(text || '').toUpperCase();
        var markers = 0;
        var found = [];
        [['INSTITUTO NACIONAL ELECTORAL', 4], ['INSTITUTO FEDERAL ELECTORAL', 4], ['CREDENCIAL PARA VOTAR', 4],
         ['CLAVE DE ELECTOR', 3], ['CURP', 2], ['DOMICILIO', 1], ['SECCION', 1], ['SECCIÓN', 1],
         ['VIGENCIA', 1], ['MEXICO', 1], ['MÉXICO', 1], ['NOMBRE', 1], ['FECHA DE NACIMIENTO', 2]].forEach(function (m) {
            if (t.indexOf(m[0]) !== -1) { markers += m[1]; found.push(m[0]); }
        });
        var curpMatch = t.replace(/\s/g, '').match(/[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z\d]\d/);
        var electorMatch = t.replace(/\s/g, '').match(/[A-Z]{6}\d{8}[A-Z]\d{3}/);
        return {
            score: markers,
            isLikelyINE: markers >= 4,
            markersFound: found,
            curp: curpMatch ? curpMatch[0] : null,
            claveElector: electorMatch ? electorMatch[0] : null
        };
    }

    /* ---------- Detección de comprobante de domicilio en OCR ---------- */
    function analyzeProofOfAddressText(text) {
        var t = String(text || '').toUpperCase();
        var providers = ['CFE', 'COMISION FEDERAL', 'COMISIÓN FEDERAL', 'TELMEX', 'TOTALPLAY', 'IZZI', 'MEGACABLE', 'SIAPA', 'AGUA', 'GAS NATURAL', 'NATURGY', 'ESTADO DE CUENTA', 'PREDIAL', 'TELEFONICA', 'TELEFÓNICA', 'AT&T', 'RECIBO'];
        var found = providers.filter(function (p) { return t.indexOf(p) !== -1; });
        var hasCp = /\b\d{5}\b/.test(t);
        return {
            providersFound: found,
            hasPostalCode: hasCp,
            isLikelyProof: found.length > 0 || hasCp
        };
    }

    /* ---------- Detección de comprobante de ingresos en OCR ---------- */
    function analyzeIncomeProofText(text) {
        var t = String(text || '').toUpperCase();
        var markers = ['NOMINA', 'NÓMINA', 'RECIBO DE PAGO', 'PERCEPCIONES', 'DEDUCCIONES', 'ESTADO DE CUENTA',
            'SALDO PROMEDIO', 'DEPOSITOS', 'DEPÓSITOS', 'DECLARACION ANUAL', 'DECLARACIÓN ANUAL', 'SAT',
            'BBVA', 'SANTANDER', 'BANORTE', 'HSBC', 'BANAMEX', 'CITIBANAMEX', 'SCOTIABANK', 'BANREGIO',
            'HONORARIOS', 'INGRESOS', 'SUELDO', 'SALARIO'];
        var found = markers.filter(function (m) { return t.indexOf(m) !== -1; });
        return {
            markersFound: found,
            isLikelyIncomeProof: found.length >= 2
        };
    }

    /* ---------- Scoring de riesgo AML (3 niveles, RCG 2026) ---------- */
    // Heurística de clasificación inicial; la calificación final la hace el
    // oficial de cumplimiento. Sectores tomados de las actividades vulnerables
    // de la LFPIORPI y prácticas de mercado.
    var HIGH_RISK_SECTORS = ['juegos_apuestas', 'joyeria_metales', 'arte_antiguedades', 'inmobiliario',
        'blindaje_valores', 'prestamos_empeño', 'comercio_exterior', 'construccion', 'activos_virtuales',
        'efectivo_intensivo', 'donativos_osc'];

    function computeRiskScore(profile) {
        profile = profile || {};
        var score = 0;
        var reasons = [];
        if (profile.pepSelf) { score += 40; reasons.push('PEP directa'); }
        if (profile.pepFamily) { score += 25; reasons.push('Familiar o asociado de PEP'); }
        if (profile.foreignTaxResidency) { score += 15; reasons.push('Residencia fiscal extranjera'); }
        if (HIGH_RISK_SECTORS.indexOf(profile.sector) !== -1) { score += 20; reasons.push('Sector de alto riesgo'); }
        if (profile.monthlyVolume === 'mas_500k') { score += 20; reasons.push('Volumen mensual alto'); }
        else if (profile.monthlyVolume === '100k_500k') { score += 10; reasons.push('Volumen mensual medio-alto'); }
        if (profile.sourceOfFunds === 'efectivo' || profile.sourceOfFunds === 'otro') { score += 15; reasons.push('Origen de recursos a verificar'); }
        if (profile.thirdParty) { score += 25; reasons.push('Opera por cuenta de un tercero'); }
        if (profile.personType === 'moral') { score += 5; reasons.push('Persona moral'); }
        var level = score >= 50 ? 'alto' : score >= 25 ? 'medio' : 'bajo';
        return { score: score, level: level, reasons: reasons };
    }

    /* ---------- Similitud de nombres (OCR vs formulario) ---------- */
    function normalizeForCompare(s) {
        return String(s || '').toUpperCase()
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .replace(/[^A-ZÑ ]/g, ' ').replace(/\s+/g, ' ').trim();
    }

    function nameMatchScore(formName, ocrText) {
        // Proporción de palabras del nombre (>2 letras) encontradas en el texto OCR
        var name = normalizeForCompare(formName);
        var text = normalizeForCompare(ocrText);
        var words = name.split(' ').filter(function (w) { return w.length > 2; });
        if (!words.length) return 0;
        var hits = words.filter(function (w) { return text.indexOf(w) !== -1; }).length;
        return hits / words.length;
    }

    return {
        validateRFC: validateRFC,
        rfcCheckDigit: rfcCheckDigit,
        validateCURP: validateCURP,
        validateCLABE: validateCLABE,
        validatePhone: validatePhone,
        validateEmail: validateEmail,
        validateCP: validateCP,
        validateName: validateName,
        validateBirthdate: validateBirthdate,
        crossCheckRfcCurp: crossCheckRfcCurp,
        validateFile: validateFile,
        analyzeIneText: analyzeIneText,
        analyzeProofOfAddressText: analyzeProofOfAddressText,
        analyzeIncomeProofText: analyzeIncomeProofText,
        computeRiskScore: computeRiskScore,
        HIGH_RISK_SECTORS: HIGH_RISK_SECTORS,
        nameMatchScore: nameMatchScore
    };
});
