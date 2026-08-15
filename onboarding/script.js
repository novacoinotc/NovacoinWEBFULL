/*
 * NovaCoin Onboarding — wizard KYC
 * Pasos, validación en vivo (NovaValidators), compresión de imágenes,
 * OCR (Tesseract.js, lazy), detección de rostro (face-api, lazy),
 * cámara para selfie y envío a /api/onboarding.
 */
document.addEventListener('DOMContentLoaded', function () {
    'use strict';
    var V = window.NovaValidators;

    /* ══ Esqueleto compartido del sitio ══ */
    var nav = document.getElementById('nav');
    window.addEventListener('scroll', function () {
        nav.classList.toggle('scrolled', window.scrollY > 50);
    }, { passive: true });

    var navToggle = document.getElementById('navToggle');
    var navLinks = document.getElementById('navLinks');
    if (navToggle && navLinks) {
        navToggle.addEventListener('click', function () {
            var open = navLinks.classList.toggle('open');
            navToggle.classList.toggle('open', open);
            document.body.style.overflow = open ? 'hidden' : '';
        });
        navLinks.querySelectorAll('.nav__link').forEach(function (l) {
            l.addEventListener('click', function () {
                navLinks.classList.remove('open');
                navToggle.classList.remove('open');
                document.body.style.overflow = '';
            });
        });
    }

    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            if (e.isIntersecting) { e.target.classList.add('v'); io.unobserve(e.target); }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    document.querySelectorAll('.anim').forEach(function (el) { io.observe(el); });

    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
        a.addEventListener('click', function (ev) {
            var t = document.querySelector(a.getAttribute('href'));
            if (t) { ev.preventDefault(); window.scrollTo({ top: t.offsetTop - 70, behavior: 'smooth' }); }
        });
    });

    /* ══ Estados de México ══ */
    var ESTADOS = ['Aguascalientes', 'Baja California', 'Baja California Sur', 'Campeche', 'Chiapas', 'Chihuahua', 'Ciudad de México', 'Coahuila', 'Colima', 'Durango', 'Estado de México', 'Guanajuato', 'Guerrero', 'Hidalgo', 'Jalisco', 'Michoacán', 'Morelos', 'Nayarit', 'Nuevo León', 'Oaxaca', 'Puebla', 'Querétaro', 'Quintana Roo', 'San Luis Potosí', 'Sinaloa', 'Sonora', 'Tabasco', 'Tamaulipas', 'Tlaxcala', 'Veracruz', 'Yucatán', 'Zacatecas'];
    var estadoSel = document.getElementById('estado');
    ESTADOS.forEach(function (e) {
        var o = document.createElement('option');
        o.value = e; o.textContent = e;
        estadoSel.appendChild(o);
    });

    // Mayoría de edad en el date picker
    var fnac = document.getElementById('fechaNacimiento');
    var today = new Date();
    fnac.max = (today.getFullYear() - 18) + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    fnac.min = '1900-01-01';

    /* ══ Estado del wizard ══ */
    var form = document.getElementById('onbForm');
    var steps = Array.prototype.slice.call(form.querySelectorAll('.onb-step'));
    var current = 0;
    var files = {};    // { comprobante, ineFrente, ineReverso, selfie } → { file, dataUrl, name, isPdf }
    var checks = {     // resultados de los motores de detección
        comprobante: null, ineFrente: null, ineReverso: null, selfie: null,
        ingresos: null, actaConstitutiva: null, csf: null, poder: null
    };

    var backBtn = document.getElementById('backBtn');
    var nextBtn = document.getElementById('nextBtn');
    var stepCount = document.getElementById('stepCount');
    var progressFill = document.getElementById('progressFill');
    var progressSteps = document.getElementById('progressSteps');
    var controls = document.getElementById('onbControls');
    var submitError = document.getElementById('submitError');

    steps.forEach(function (s, i) {
        var el = document.createElement('span');
        el.className = 'onb__progress-step';
        el.textContent = s.dataset.title;
        el.dataset.step = i;
        progressSteps.appendChild(el);
    });

    /* ══ Telemetría de sesión (seguimiento de prospectos) ══ */
    var SESSION_KEY = 'novacoin_onboarding_session';
    var sessionId;
    try {
        sessionId = localStorage.getItem(SESSION_KEY);
        if (!sessionId) {
            sessionId = (window.crypto && crypto.randomUUID)
                ? crypto.randomUUID()
                : 'sess-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
            localStorage.setItem(SESSION_KEY, sessionId);
        }
    } catch (e) {
        sessionId = 'sess-' + Math.random().toString(36).slice(2, 12);
    }

    function track(event, extra) {
        // La telemetría nunca debe romper ni frenar el flujo del usuario.
        try {
            var fe = form.elements;
            var body = JSON.stringify(Object.assign({
                sessionId: sessionId,
                event: event,
                step: current,
                platforms: selectedPlatforms(),
                personType: fe.personType.value,
                nombre: (fe.nombre.value + ' ' + fe.apellidoPaterno.value).trim() || null,
                correo: fe.correo.value.trim() || null,
                telefono: fe.telefono.value.trim() || null,
                docs: Object.keys(files)
            }, extra || {}));
            if (navigator.sendBeacon) {
                navigator.sendBeacon('/api/track', new Blob([body], { type: 'application/json' }));
            } else {
                fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
            }
        } catch (e) { /* sin telemetría */ }
    }

    function renderStep() {
        steps.forEach(function (s, i) { s.hidden = i !== current; });
        backBtn.disabled = current === 0;
        nextBtn.querySelector('span').textContent = current === steps.length - 1 ? 'Enviar solicitud' : 'Continuar';
        stepCount.textContent = 'Paso ' + (current + 1) + ' de ' + steps.length;
        progressFill.style.width = ((current) / (steps.length - 1) * 100) + '%';
        progressSteps.querySelectorAll('.onb__progress-step').forEach(function (el, i) {
            el.classList.toggle('active', i === current);
            el.classList.toggle('done', i < current);
        });
        if (current === steps.length - 1) buildReview();
        var card = document.querySelector('.onb__card');
        if (card.getBoundingClientRect().top < 0) window.scrollTo({ top: document.getElementById('wizard').offsetTop - 60, behavior: 'smooth' });
    }

    /* ══ Errores por campo ══ */
    function setError(name, msg) {
        var el = form.querySelector('[data-error-for="' + name + '"]');
        if (el) el.textContent = msg || '';
        var input = form.elements[name];
        if (input && input.classList) {
            input.classList.toggle('is-invalid', !!msg);
            if (!msg && input.value) input.classList.add('is-valid');
            else input.classList.remove('is-valid');
        }
    }

    /* ══ Validación por paso ══ */
    var phoneLike = function (name) {
        var r = V.validatePhone(form.elements[name].value);
        setError(name, r.valid ? '' : r.errors[0]);
        return r.valid;
    };
    var nameLike = function (name, required) {
        var val = form.elements[name].value;
        if (!required && !val.trim()) { setError(name, ''); return true; }
        var r = V.validateName(val);
        setError(name, r.valid ? '' : r.errors[0]);
        return r.valid;
    };
    var filled = function (name, msg) {
        var ok = !!String(form.elements[name].value || '').trim();
        setError(name, ok ? '' : (msg || 'Este campo es obligatorio'));
        return ok;
    };

    var stepValidators = {
        0: function () {
            var ok = selectedPlatforms().length > 0;
            var errEl = form.querySelector('[data-error-for="platform"]');
            errEl.textContent = ok ? '' : 'Selecciona al menos una plataforma para continuar';
            return ok;
        },
        1: function () {
            var ok = true;
            var isMoral = form.elements.personType.value === 'moral';
            if (isMoral) ok = filled('razonSocial', 'Ingresa la razón social') && ok;
            if (selectedPlatforms().indexOf('novapay') !== -1) {
                ok = filled('nombreComercial', 'Ingresa el nombre comercial de tu negocio') && ok;
                ok = filled('giroNegocio', 'Indica el giro de tu negocio') && ok;
            }
            ok = nameLike('nombre', true) && ok;
            ok = nameLike('apellidoPaterno', true) && ok;
            ok = nameLike('apellidoMaterno', false) && ok;
            var f = V.validateBirthdate(form.elements.fechaNacimiento.value);
            setError('fechaNacimiento', f.valid ? '' : f.errors[0]);
            ok = f.valid && ok;
            ok = filled('ocupacion') && ok;
            return ok;
        },
        2: function () {
            var ok = phoneLike('telefono');
            var e = V.validateEmail(form.elements.correo.value);
            setError('correo', e.valid ? '' : e.errors[0]);
            var sug = document.getElementById('emailSuggestion');
            if (e.valid && e.suggestion) {
                sug.hidden = false;
                sug.innerHTML = '¿Quisiste decir <strong>' + e.suggestion + '</strong>?';
                sug.onclick = function () { form.elements.correo.value = e.suggestion; sug.hidden = true; };
            } else { sug.hidden = true; }
            return e.valid && ok;
        },
        3: function () {
            var ok = true;
            ok = filled('calle') && ok;
            ok = filled('numExt') && ok;
            ok = filled('colonia') && ok;
            var cp = V.validateCP(form.elements.cp.value);
            setError('cp', cp.valid ? '' : cp.errors[0]);
            ok = cp.valid && ok;
            ok = filled('ciudad') && ok;
            ok = filled('estado', 'Selecciona tu estado') && ok;
            var hasFile = !!files.comprobante;
            setError('fileComprobante', hasFile ? '' : 'Sube tu comprobante de domicilio');
            return ok && hasFile;
        },
        4: function () {
            var ok = true;
            var isMoral = form.elements.personType.value === 'moral';
            var r = V.validateRFC(form.elements.rfc.value);
            setError('rfc', r.valid ? '' : r.errors[0]);
            ok = r.valid && ok;
            if (r.valid && isMoral && r.type !== 'moral') { setError('rfc', 'Para persona moral el RFC debe ser de 12 caracteres'); ok = false; }
            if (r.valid && !isMoral && r.type !== 'fisica') { setError('rfc', 'Para persona física el RFC debe ser de 13 caracteres'); ok = false; }
            if (!isMoral) {
                var c = V.validateCURP(form.elements.curp.value);
                setError('curp', c.valid ? '' : c.errors[0]);
                ok = c.valid && ok;
                if (r.valid && c.valid) {
                    var x = V.crossCheckRfcCurp(r.value, c.value);
                    if (!x.valid) { setError('curp', x.errors[0]); ok = false; }
                }
            }
            ok = filled('regimenFiscal', 'Selecciona tu régimen fiscal') && ok;
            if (!document.getElementById('clabeField').hidden && form.elements.clabe.value.trim()) {
                var cl = V.validateCLABE(form.elements.clabe.value);
                setError('clabe', cl.valid ? '' : cl.errors[0]);
                ok = cl.valid && ok;
            }
            return ok;
        },
        5: function () {
            var ok = true;
            ok = filled('origenRecursos', 'Indica el origen de tus recursos') && ok;
            ok = filled('sectorEconomico', 'Selecciona tu sector') && ok;
            ok = filled('usoCuenta', 'Indica el uso previsto') && ok;
            ok = filled('montoMensual', 'Selecciona un rango') && ok;
            ok = filled('opsMensuales', 'Selecciona un rango') && ok;
            // radios obligatorios
            [['pepSelf', 'Responde la pregunta sobre cargos públicos'],
             ['pepFamily', 'Responde la pregunta sobre familiares PEP'],
             ['cuentaPropia', 'Indica si operas por cuenta propia'],
             ['residenciaExtranjera', 'Responde la pregunta de residencia fiscal']].forEach(function (q) {
                var answered = !!form.querySelector('input[name="' + q[0] + '"]:checked');
                var el = form.querySelector('[data-error-for="' + q[0] + '"]');
                if (el) el.textContent = answered ? '' : q[1];
                ok = answered && ok;
            });
            // detalles condicionales
            if (radioVal('pepSelf') === 'si') ok = filled('pepCargo', 'Describe el cargo público') && ok;
            if (radioVal('pepFamily') === 'si') ok = filled('pepFamiliarDetalle', 'Describe el parentesco y cargo') && ok;
            if (radioVal('cuentaPropia') === 'no') {
                ok = nameLike('beneficiarioNombre', true) && ok;
                ok = filled('beneficiarioRelacion', 'Indica la relación') && ok;
            }
            if (radioVal('residenciaExtranjera') === 'si') {
                ok = filled('paisResidencia', 'Indica el país') && ok;
                ok = filled('tinExtranjero', 'Indica tu TIN') && ok;
            }
            var hasIncome = !!files.ingresos;
            setError('fileIngresos', hasIncome ? '' : 'Sube tu comprobante de ingresos');
            return ok && hasIncome;
        },
        6: function () {
            var ok = true;
            ok = nameLike('ref1Nombre', true) && ok;
            ok = phoneLike('ref1Telefono') && ok;
            ok = filled('ref1Relacion', 'Selecciona la relación') && ok;
            ok = nameLike('ref2Nombre', true) && ok;
            ok = phoneLike('ref2Telefono') && ok;
            ok = filled('ref2Relacion', 'Selecciona la relación') && ok;
            var t1 = V.validatePhone(form.elements.ref1Telefono.value);
            var t2 = V.validatePhone(form.elements.ref2Telefono.value);
            var own = V.validatePhone(form.elements.telefono.value);
            if (t1.valid && t2.valid && t1.value === t2.value) { setError('ref2Telefono', 'Las dos referencias no pueden tener el mismo teléfono'); ok = false; }
            if (own.valid && ((t1.valid && t1.value === own.value) || (t2.valid && t2.value === own.value))) {
                setError(t1.value === own.value ? 'ref1Telefono' : 'ref2Telefono', 'La referencia no puede ser tu propio teléfono'); ok = false;
            }
            return ok;
        },
        7: function () {
            var okF = !!files.ineFrente, okR = !!files.ineReverso;
            setError('fileIneFrente', okF ? '' : 'Sube el frente de tu identificación');
            setError('fileIneReverso', okR ? '' : 'Sube el reverso de tu identificación');
            var ok = okF && okR;
            if (form.elements.personType.value === 'moral') {
                var okA = !!files.actaConstitutiva, okC = !!files.csf;
                setError('fileActa', okA ? '' : 'Sube el acta constitutiva');
                setError('fileCsf', okC ? '' : 'Sube la constancia de situación fiscal');
                ok = ok && okA && okC;
            }
            return ok;
        },
        8: function () {
            var ok = !!files.selfie;
            setError('fileSelfie', ok ? '' : 'Necesitamos tu selfie sosteniendo tu identificación');
            return ok;
        },
        9: function () {
            var p = form.elements.consentPrivacy.checked;
            var t = form.elements.consentTruth.checked;
            var el = form.querySelector('[data-error-for="consent"]');
            el.textContent = (p && t) ? '' : 'Debes aceptar ambas declaraciones para enviar tu solicitud';
            return p && t;
        }
    };

    function radioVal(name) {
        var r = form.querySelector('input[name="' + name + '"]:checked');
        return r ? r.value : null;
    }

    function selectedPlatforms() {
        return Array.prototype.map.call(
            form.querySelectorAll('input[name="platforms"]:checked'),
            function (c) { return c.value; }
        );
    }

    function applyPlatforms() {
        var sel = selectedPlatforms();
        document.getElementById('clabeField').hidden = sel.indexOf('novacore') === -1;
        document.getElementById('novapayFields').hidden = sel.indexOf('novapay') === -1;
    }

    /* ══ Condicionales ══ */
    function applyPersonType() {
        var isMoral = form.elements.personType.value === 'moral';
        document.getElementById('moralFields').hidden = !isMoral;
        document.getElementById('moralDocs').hidden = !isMoral;
        document.getElementById('curpField').style.display = isMoral ? 'none' : '';
        form.elements.razonSocial.required = isMoral;
        form.elements.curp.required = !isMoral;
    }
    form.elements.personType.addEventListener('change', applyPersonType);

    // preguntas AML con detalle condicional
    [['pepSelf', 'pepDetail', 'si'], ['pepFamily', 'pepFamilyDetail', 'si'],
     ['cuentaPropia', 'beneficiaryDetail', 'no'], ['residenciaExtranjera', 'foreignDetail', 'si']].forEach(function (cfg) {
        form.querySelectorAll('input[name="' + cfg[0] + '"]').forEach(function (r) {
            r.addEventListener('change', function () {
                document.getElementById(cfg[1]).hidden = radioVal(cfg[0]) !== cfg[2];
                var el = form.querySelector('[data-error-for="' + cfg[0] + '"]');
                if (el) el.textContent = '';
            });
        });
    });
    form.querySelectorAll('input[name="platforms"]').forEach(function (r) {
        r.addEventListener('change', function () {
            applyPlatforms();
            form.querySelector('[data-error-for="platform"]').textContent = '';
        });
    });

    // Validación en vivo: al salir del campo se valida; al teclear solo se
    // re-valida si ya había error/sugerencia visible. Así el layout no cambia
    // durante el blur que dispara el clic en "Continuar" (el botón se movería).
    function emailLive() {
        var val = form.elements.correo.value;
        var sug = document.getElementById('emailSuggestion');
        if (!val) { setError('correo', ''); sug.hidden = true; return; }
        var e = V.validateEmail(val);
        setError('correo', e.valid ? '' : e.errors[0]);
        if (e.valid && e.suggestion) {
            sug.hidden = false;
            sug.innerHTML = '¿Quisiste decir <strong>' + e.suggestion + '</strong>?';
            sug.onclick = function () { form.elements.correo.value = e.suggestion; sug.hidden = true; };
        } else { sug.hidden = true; }
    }
    // El cruce RFC/CURP se aplica también en vivo para que el blur tardío de un
    // campo no borre el error de incongruencia puesto por el validador del paso
    function fiscalLive() {
        var rfcVal = form.elements.rfc.value, curpVal = form.elements.curp.value;
        var r = V.validateRFC(rfcVal);
        showCheck('rfcCheck', r.valid, r.valid ? 'RFC válido (' + (r.type === 'fisica' ? 'persona física' : 'persona moral') + ') — dígito verificador correcto' : null);
        setError('rfc', r.valid || !rfcVal ? '' : r.errors[0]);
        var c = V.validateCURP(curpVal);
        var curpMsg = c.valid || !curpVal ? '' : c.errors[0];
        var curpOk = c.valid;
        if (r.valid && c.valid) {
            var x = V.crossCheckRfcCurp(rfcVal, curpVal);
            if (!x.valid) { curpMsg = x.errors[0]; curpOk = false; }
        }
        showCheck('curpCheck', curpOk, curpOk ? 'CURP válida — dígito verificador correcto' : null);
        setError('curp', curpMsg);
    }
    var LIVE_FIELDS = [
        ['rfc', fiscalLive],
        ['curp', fiscalLive],
        ['telefono', function () { if (form.elements.telefono.value) phoneLike('telefono'); }],
        ['correo', emailLive],
        ['cp', function () { if (form.elements.cp.value) { var r = V.validateCP(form.elements.cp.value); setError('cp', r.valid ? '' : r.errors[0]); } }]
    ];
    LIVE_FIELDS.forEach(function (pair) {
        var input = form.elements[pair[0]];
        input.addEventListener('blur', pair[1]);
        input.addEventListener('input', function () {
            var hasError = !!form.querySelector('[data-error-for="' + pair[0] + '"]').textContent;
            var sugVisible = pair[0] === 'correo' && !document.getElementById('emailSuggestion').hidden;
            if (hasError || sugVisible) pair[1]();
        });
    });

    function showCheck(id, ok, msg) {
        var el = document.getElementById(id);
        if (!el) return;
        el.hidden = !msg;
        el.className = 'field-check ' + (ok ? 'ok' : 'warn');
        el.textContent = msg ? '✓ ' + msg : '';
    }

    /* ══ Navegación ══ */
    nextBtn.addEventListener('click', function () {
        if (!stepValidators[current]()) return;
        if (current === steps.length - 1) { submit(); return; }
        track('step_complete', { step: current });
        current++;
        renderStep();
        saveDraft();
        track('step_view', { step: current });
    });
    backBtn.addEventListener('click', function () {
        if (current > 0) { current--; renderStep(); }
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); nextBtn.click(); });

    /* ══ Compresión de imágenes (canvas, sin dependencias) ══ */
    function compressImage(file, maxDim, quality) {
        return new Promise(function (resolve, reject) {
            var img = new Image();
            var url = URL.createObjectURL(file);
            img.onload = function () {
                URL.revokeObjectURL(url);
                var w = img.naturalWidth, h = img.naturalHeight;
                var scale = Math.min(1, maxDim / Math.max(w, h));
                var canvas = document.createElement('canvas');
                canvas.width = Math.round(w * scale);
                canvas.height = Math.round(h * scale);
                canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen')); };
            img.src = url;
        });
    }

    function fileToDataUrl(file) {
        return new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () { resolve(r.result); };
            r.onerror = reject;
            r.readAsDataURL(file);
        });
    }

    /* ══ Motor OCR (Tesseract.js, carga perezosa desde CDN) ══ */
    var tesseractPromise = null;
    function loadTesseract() {
        if (tesseractPromise) return tesseractPromise;
        tesseractPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
            s.onload = function () { resolve(window.Tesseract); };
            s.onerror = function () { reject(new Error('OCR no disponible')); };
            document.head.appendChild(s);
        });
        return tesseractPromise;
    }

    function runOcr(dataUrl) {
        return loadTesseract().then(function (T) {
            return T.recognize(dataUrl, 'spa', { logger: function () {} });
        }).then(function (out) { return out.data.text || ''; });
    }

    /* ══ Motor de rostro (face-api, carga perezosa desde CDN) ══ */
    var faceApiPromise = null;
    var FACE_CDN = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/dist/face-api.min.js';
    var FACE_MODELS = 'https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model';
    function loadFaceApi() {
        if (faceApiPromise) return faceApiPromise;
        faceApiPromise = new Promise(function (resolve, reject) {
            var s = document.createElement('script');
            s.src = FACE_CDN;
            s.onload = function () {
                window.faceapi.nets.tinyFaceDetector.loadFromUri(FACE_MODELS)
                    .then(function () { resolve(window.faceapi); })
                    .catch(reject);
            };
            s.onerror = function () { reject(new Error('Detector de rostro no disponible')); };
            document.head.appendChild(s);
        });
        return faceApiPromise;
    }

    function countFaces(dataUrl) {
        return loadFaceApi().then(function (fa) {
            return new Promise(function (resolve, reject) {
                var img = new Image();
                img.onload = function () {
                    fa.detectAllFaces(img, new fa.TinyFaceDetectorOptions({ scoreThreshold: 0.4 }))
                        .then(function (dets) { resolve(dets.length); })
                        .catch(reject);
                };
                img.onerror = reject;
                img.src = dataUrl;
            });
        });
    }

    /* ══ Análisis por documento (no bloqueante) ══ */
    function setScanStatus(key, cls, msg) {
        var el = form.querySelector('[data-testid="scan-' + kebab(key) + '"]');
        if (el) { el.className = 'upload-preview__scan ' + cls; el.textContent = msg; }
    }
    function kebab(k) {
        return k.replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
    }

    function fullName() {
        return [form.elements.nombre.value, form.elements.apellidoPaterno.value, form.elements.apellidoMaterno.value].join(' ');
    }

    function analyzeDocument(key) {
        var f = files[key];
        if (!f) return;
        if (f.isPdf) {
            checks[key] = { engine: 'none', status: 'manual_review', note: 'PDF — se revisará manualmente' };
            setScanStatus(key, 'warn', 'PDF recibido — lo revisará nuestro equipo');
            return;
        }
        setScanStatus(key, 'scanning', 'Analizando documento…');
        if (key === 'selfie') {
            countFaces(f.dataUrl).then(function (n) {
                if (n >= 1) {
                    checks.selfie = { engine: 'face-api', status: 'ok', faces: n };
                    setScanStatus(key, 'ok', '✓ Rostro detectado' + (n > 1 ? ' (' + n + ' rostros — incluye tu INE)' : ''));
                } else {
                    checks.selfie = { engine: 'face-api', status: 'no_face', faces: 0 };
                    setScanStatus(key, 'warn', 'No detectamos un rostro claro — verifica la iluminación o vuelve a tomarla');
                }
            }).catch(function () {
                checks.selfie = { engine: 'none', status: 'manual_review' };
                setScanStatus(key, 'warn', 'Foto recibida — se verificará manualmente');
            });
            return;
        }
        runOcr(f.dataUrl).then(function (text) {
            if (key === 'comprobante') {
                var a = V.analyzeProofOfAddressText(text);
                checks.comprobante = { engine: 'tesseract', status: a.isLikelyProof ? 'ok' : 'unclear', detail: a };
                setScanStatus(key, a.isLikelyProof ? 'ok' : 'warn',
                    a.isLikelyProof ? '✓ Comprobante legible' + (a.providersFound.length ? ' (' + a.providersFound[0] + ')' : '')
                                    : 'No pudimos confirmar el tipo de comprobante — se revisará manualmente');
            } else if (key === 'ingresos') {
                var inc = V.analyzeIncomeProofText(text);
                checks.ingresos = { engine: 'tesseract', status: inc.isLikelyIncomeProof ? 'ok' : 'unclear', detail: inc };
                setScanStatus(key, inc.isLikelyIncomeProof ? 'ok' : 'warn',
                    inc.isLikelyIncomeProof ? '✓ Comprobante de ingresos legible'
                                            : 'No pudimos confirmar el tipo de documento — se revisará manualmente');
            } else if (key === 'actaConstitutiva' || key === 'csf' || key === 'poder') {
                var legible = (text || '').replace(/\s/g, '').length > 120;
                checks[key] = { engine: 'tesseract', status: legible ? 'ok' : 'unclear', textLength: (text || '').length };
                setScanStatus(key, legible ? 'ok' : 'warn',
                    legible ? '✓ Documento legible' : 'Documento poco legible — se revisará manualmente');
            } else {
                var ine = V.analyzeIneText(text);
                var match = V.nameMatchScore(fullName(), text);
                checks[key] = { engine: 'tesseract', status: ine.isLikelyINE ? 'ok' : 'unclear', detail: ine, nameMatch: match };
                if (ine.curp && !form.elements.curp.value) {
                    var c = V.validateCURP(ine.curp);
                    if (c.valid) { form.elements.curp.value = ine.curp; showCheck('curpCheck', true, 'CURP detectada en tu INE'); }
                }
                var msg, cls;
                if (ine.isLikelyINE && match >= 0.5) { cls = 'ok'; msg = '✓ INE verificada — nombre coincide'; }
                else if (ine.isLikelyINE) { cls = 'ok'; msg = '✓ INE detectada' + (match > 0 ? '' : ' — verifica que sea tuya'); }
                else { cls = 'warn'; msg = 'Documento poco legible — se revisará manualmente'; }
                setScanStatus(key, cls, msg);
            }
        }).catch(function () {
            checks[key] = { engine: 'none', status: 'manual_review' };
            setScanStatus(key, 'warn', 'Documento recibido — se verificará manualmente');
        });
    }

    /* ══ Uploads ══ */
    var UPLOADS = {
        comprobante: { input: 'fileComprobante', imagesOnly: false },
        ingresos: { input: 'fileIngresos', imagesOnly: false },
        actaConstitutiva: { input: 'fileActa', imagesOnly: false },
        csf: { input: 'fileCsf', imagesOnly: false },
        poder: { input: 'filePoder', imagesOnly: false },
        ineFrente: { input: 'fileIneFrente', imagesOnly: true },
        ineReverso: { input: 'fileIneReverso', imagesOnly: true },
        selfie: { input: 'fileSelfie', imagesOnly: true }
    };

    Object.keys(UPLOADS).forEach(function (key) {
        var cfg = UPLOADS[key];
        var block = form.querySelector('[data-upload="' + key + '"]');
        var drop = block.querySelector('.upload-drop');
        var input = document.getElementById(cfg.input);
        var preview = key === 'selfie'
            ? form.querySelector('[data-upload-preview="selfie"]')
            : block.querySelector('.upload-preview');

        function openPicker() { input.click(); }
        drop.addEventListener('click', openPicker);
        drop.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPicker(); } });
        ['dragover', 'dragleave', 'drop'].forEach(function (evName) {
            drop.addEventListener(evName, function (e) {
                e.preventDefault();
                drop.classList.toggle('dragover', evName === 'dragover');
                if (evName === 'drop' && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
            });
        });
        input.addEventListener('change', function () { if (input.files.length) handleFile(input.files[0]); });

        function handleFile(file) {
            var check = V.validateFile(file, { imagesOnly: cfg.imagesOnly });
            if (!check.valid) { setError(cfg.input, check.errors[0]); return; }
            var isPdf = file.type === 'application/pdf';
            if (isPdf && file.size > 3 * 1024 * 1024) {
                setError(cfg.input, 'El PDF supera 3 MB — súbelo más ligero o toma una foto del documento');
                return;
            }
            setError(cfg.input, '');
            var ready = isPdf ? fileToDataUrl(file) : compressImage(file, 1600, 0.72);
            ready.then(function (dataUrl) {
                files[key] = { name: file.name, dataUrl: dataUrl, isPdf: isPdf };
                preview.hidden = false;
                var img = preview.querySelector('img');
                if (!isPdf) { img.hidden = false; img.src = dataUrl; } else { img.hidden = true; }
                preview.querySelector('.upload-preview__name').textContent = file.name;
                drop.parentElement.querySelector('.upload-drop').style.display = 'none';
                if (key === 'selfie') document.getElementById('selfieActions').hidden = true;
                track('doc_upload', { meta: { doc: key } });
                analyzeDocument(key);
            }).catch(function () {
                setError(cfg.input, 'No pudimos procesar el archivo, intenta con otro');
            });
        }

        preview.querySelector('.upload-preview__remove').addEventListener('click', function () {
            delete files[key];
            checks[key] = null;
            preview.hidden = true;
            input.value = '';
            drop.style.display = '';
            if (key === 'selfie') { document.getElementById('selfieActions').hidden = false; }
            setScanStatus(key, '', '');
        });
    });

    /* ══ Cámara para selfie ══ */
    var cameraWrap = document.getElementById('selfieCamera');
    var video = document.getElementById('selfieVideo');
    var stream = null;

    document.getElementById('openCameraBtn').addEventListener('click', function () {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setError('fileSelfie', 'Tu navegador no soporta cámara — sube una foto');
            return;
        }
        navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
            .then(function (s) {
                stream = s;
                video.srcObject = s;
                cameraWrap.hidden = false;
                setError('fileSelfie', '');
            })
            .catch(function () {
                setError('fileSelfie', 'No pudimos acceder a la cámara — revisa los permisos o sube una foto');
            });
    });

    document.getElementById('captureBtn').addEventListener('click', function () {
        var canvas = document.createElement('canvas');
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        var ctx = canvas.getContext('2d');
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1); // reflejo natural de selfie
        ctx.drawImage(video, 0, 0);
        var dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        stopCamera();
        files.selfie = { name: 'selfie-camara.jpg', dataUrl: dataUrl, isPdf: false };
        var preview = form.querySelector('[data-upload-preview="selfie"]');
        preview.hidden = false;
        var img = preview.querySelector('img');
        img.hidden = false; img.src = dataUrl;
        preview.querySelector('.upload-preview__name').textContent = 'Selfie capturada';
        document.getElementById('selfieActions').hidden = true;
        setError('fileSelfie', '');
        analyzeDocument('selfie');
    });

    function stopCamera() {
        if (stream) { stream.getTracks().forEach(function (t) { t.stop(); }); stream = null; }
        cameraWrap.hidden = true;
    }

    /* ══ Borrador en localStorage (solo texto) ══ */
    var DRAFT_KEY = 'novacoin_onboarding_draft';
    function saveDraft() {
        try {
            var data = {};
            Array.prototype.forEach.call(form.elements, function (el) {
                if (!el.name || el.type === 'file' || el.type === 'checkbox') return;
                if (el.type === 'radio') { if (el.checked) data[el.name] = el.value; return; }
                data[el.name] = el.value;
            });
            data.platforms = selectedPlatforms();
            localStorage.setItem(DRAFT_KEY, JSON.stringify(data));
        } catch (e) { /* almacenamiento no disponible */ }
    }
    (function loadDraft() {
        try {
            var raw = localStorage.getItem(DRAFT_KEY);
            if (!raw) return;
            var data = JSON.parse(raw);
            Object.keys(data).forEach(function (name) {
                if (name === 'platforms') return; // se restaura aparte
                var el = form.elements[name];
                if (!el) return;
                if (el instanceof RadioNodeList || (el.length && el[0] && el[0].type === 'radio')) {
                    var radios = form.querySelectorAll('[name="' + name + '"]');
                    radios.forEach(function (r) { r.checked = r.value === data[name]; });
                } else { el.value = data[name]; }
            });
            if (Array.isArray(data.platforms)) {
                form.querySelectorAll('input[name="platforms"]').forEach(function (c) {
                    c.checked = data.platforms.indexOf(c.value) !== -1;
                });
            }
            applyPlatforms();
            applyPersonType();
            // re-aplica los bloques condicionales de las preguntas AML
            document.getElementById('pepDetail').hidden = data.pepSelf !== 'si';
            document.getElementById('pepFamilyDetail').hidden = data.pepFamily !== 'si';
            document.getElementById('beneficiaryDetail').hidden = data.cuentaPropia !== 'no';
            document.getElementById('foreignDetail').hidden = data.residenciaExtranjera !== 'si';
        } catch (e) { /* borrador corrupto, se ignora */ }
    })();
    form.addEventListener('change', saveDraft);

    /* ══ Resumen ══ */
    function buildReview() {
        var el = document.getElementById('reviewSummary');
        var fe = form.elements;
        var isMoral = fe.personType.value === 'moral';
        var PLATFORM_NAMES = { novacore: 'Novacore', rfq: 'RFQ / Exchange', novapay: 'NovaPay' };
        var platformList = selectedPlatforms().map(function (p) { return PLATFORM_NAMES[p] || p; }).join(', ') || '—';
        var hasNovapay = selectedPlatforms().indexOf('novapay') !== -1;

        function group(title, stepIdx, rows) {
            var h = '<div class="review__group"><h4>' + title + '<span class="review__edit" data-goto="' + stepIdx + '">Editar</span></h4><dl>';
            rows.forEach(function (r) {
                if (r[1]) h += '<div class="review__row"><dt>' + r[0] + '</dt><dd>' + escapeHtml(r[1]) + '</dd></div>';
            });
            return h + '</dl></div>';
        }
        function docBadge(label, key) {
            var has = !!files[key];
            return '<span class="review__doc' + (has ? '' : ' review__doc--missing') + '">' + (has ? '✓' : '✕') + ' ' + label + '</span>';
        }

        el.innerHTML =
            group('Plataformas', 0, [['Cuenta para', platformList]]) +
            group('Datos generales', 1, [
                isMoral ? ['Razón social', fe.razonSocial.value] : null,
                [isMoral ? 'Representante legal' : 'Nombre completo', fullName()],
                ['Fecha de nacimiento', fe.fechaNacimiento.value],
                ['Ocupación', fe.ocupacion.value],
                hasNovapay ? ['Negocio (NovaPay)', fe.nombreComercial.value + ' — ' + fe.giroNegocio.value] : null
            ].filter(Boolean)) +
            group('Contacto', 2, [['Teléfono', fe.telefono.value], ['Correo', fe.correo.value]]) +
            group('Domicilio', 3, [
                ['Dirección', fe.calle.value + ' ' + fe.numExt.value + ', ' + fe.colonia.value],
                ['Ciudad', fe.ciudad.value + ', ' + fe.estado.value + ' — CP ' + fe.cp.value]
            ]) +
            group('Datos fiscales', 4, [
                ['RFC', fe.rfc.value.toUpperCase()],
                !isMoral ? ['CURP', fe.curp.value.toUpperCase()] : null,
                ['Régimen', (fe.regimenFiscal.selectedOptions[0] || {}).textContent],
                fe.clabe.value ? ['CLABE', fe.clabe.value] : null
            ].filter(Boolean)) +
            group('Perfil transaccional', 5, [
                ['Origen de recursos', (fe.origenRecursos.selectedOptions[0] || {}).textContent],
                ['Sector', (fe.sectorEconomico.selectedOptions[0] || {}).textContent],
                ['Uso de la cuenta', (fe.usoCuenta.selectedOptions[0] || {}).textContent],
                ['Monto mensual', (fe.montoMensual.selectedOptions[0] || {}).textContent],
                ['Operaciones/mes', (fe.opsMensuales.selectedOptions[0] || {}).textContent],
                ['PEP', radioVal('pepSelf') === 'si' ? 'Sí — ' + fe.pepCargo.value : 'No'],
                ['Familiar PEP', radioVal('pepFamily') === 'si' ? 'Sí — ' + fe.pepFamiliarDetalle.value : 'No'],
                ['Cuenta propia', radioVal('cuentaPropia') === 'no' ? 'No — ' + fe.beneficiarioNombre.value : 'Sí'],
                ['Residencia fiscal extranjera', radioVal('residenciaExtranjera') === 'si' ? 'Sí — ' + fe.paisResidencia.value : 'No']
            ]) +
            group('Referencias', 6, [
                ['Referencia 1', fe.ref1Nombre.value + ' · ' + fe.ref1Telefono.value + ' (' + fe.ref1Relacion.value + ')'],
                ['Referencia 2', fe.ref2Nombre.value + ' · ' + fe.ref2Telefono.value + ' (' + fe.ref2Relacion.value + ')']
            ]) +
            '<div class="review__group"><h4>Documentos<span class="review__edit" data-goto="7">Editar</span></h4><div class="review__docs">' +
            docBadge('Comprobante de domicilio', 'comprobante') +
            docBadge('Comprobante de ingresos', 'ingresos') +
            docBadge('INE frente', 'ineFrente') +
            docBadge('INE reverso', 'ineReverso') +
            docBadge('Selfie con INE', 'selfie') +
            (isMoral ? docBadge('Acta constitutiva', 'actaConstitutiva') + docBadge('Constancia fiscal', 'csf') : '') +
            '</div></div>';

        el.querySelectorAll('.review__edit').forEach(function (b) {
            b.addEventListener('click', function () {
                current = parseInt(b.dataset.goto, 10);
                renderStep();
            });
        });
    }

    function escapeHtml(s) {
        var d = document.createElement('div');
        d.textContent = s == null ? '' : String(s);
        return d.innerHTML;
    }

    /* ══ Envío ══ */
    function submit() {
        var fe = form.elements;
        var isMoral = fe.personType.value === 'moral';
        submitError.textContent = '';
        nextBtn.classList.add('is-busy');
        nextBtn.disabled = true;

        var payload = {
            version: 2,
            sessionId: sessionId,
            platforms: selectedPlatforms(),
            personType: fe.personType.value,
            general: {
                razonSocial: isMoral ? fe.razonSocial.value.trim() : null,
                negocio: selectedPlatforms().indexOf('novapay') !== -1
                    ? { nombreComercial: fe.nombreComercial.value.trim(), giro: fe.giroNegocio.value.trim() } : null,
                nombre: fe.nombre.value.trim(),
                apellidoPaterno: fe.apellidoPaterno.value.trim(),
                apellidoMaterno: fe.apellidoMaterno.value.trim(),
                fechaNacimiento: fe.fechaNacimiento.value,
                nacionalidad: fe.nacionalidad.value,
                ocupacion: fe.ocupacion.value.trim()
            },
            contact: {
                telefono: V.validatePhone(fe.telefono.value).e164,
                correo: fe.correo.value.trim().toLowerCase()
            },
            address: {
                calle: fe.calle.value.trim(), numExt: fe.numExt.value.trim(),
                colonia: fe.colonia.value.trim(), cp: fe.cp.value.trim(),
                ciudad: fe.ciudad.value.trim(), estado: fe.estado.value
            },
            fiscal: {
                rfc: fe.rfc.value.trim().toUpperCase(),
                curp: isMoral ? null : fe.curp.value.trim().toUpperCase(),
                regimenFiscal: fe.regimenFiscal.value,
                clabe: fe.clabe.value.trim() || null
            },
            amlProfile: {
                origenRecursos: fe.origenRecursos.value,
                sectorEconomico: fe.sectorEconomico.value,
                usoCuenta: fe.usoCuenta.value,
                montoMensual: fe.montoMensual.value,
                opsMensuales: fe.opsMensuales.value,
                pepSelf: radioVal('pepSelf') === 'si',
                pepCargo: radioVal('pepSelf') === 'si' ? fe.pepCargo.value.trim() : null,
                pepFamily: radioVal('pepFamily') === 'si',
                pepFamiliarDetalle: radioVal('pepFamily') === 'si' ? fe.pepFamiliarDetalle.value.trim() : null,
                cuentaPropia: radioVal('cuentaPropia') === 'si',
                beneficiario: radioVal('cuentaPropia') === 'no'
                    ? { nombre: fe.beneficiarioNombre.value.trim(), relacion: fe.beneficiarioRelacion.value.trim() } : null,
                residenciaExtranjera: radioVal('residenciaExtranjera') === 'si',
                paisResidencia: radioVal('residenciaExtranjera') === 'si' ? fe.paisResidencia.value.trim() : null,
                tinExtranjero: radioVal('residenciaExtranjera') === 'si' ? fe.tinExtranjero.value.trim() : null
            },
            references: [
                { nombre: fe.ref1Nombre.value.trim(), telefono: V.validatePhone(fe.ref1Telefono.value).e164, relacion: fe.ref1Relacion.value },
                { nombre: fe.ref2Nombre.value.trim(), telefono: V.validatePhone(fe.ref2Telefono.value).e164, relacion: fe.ref2Relacion.value }
            ],
            documents: {
                comprobante: files.comprobante || null,
                ingresos: files.ingresos || null,
                ineFrente: files.ineFrente || null,
                ineReverso: files.ineReverso || null,
                selfie: files.selfie || null,
                actaConstitutiva: files.actaConstitutiva || null,
                csf: files.csf || null,
                poder: files.poder || null
            },
            checks: checks,
            consent: { privacy: fe.consentPrivacy.checked, truth: fe.consentTruth.checked, ts: new Date().toISOString() },
            meta: { userAgent: navigator.userAgent, page: location.href }
        };

        // Clasificación inicial de riesgo (bajo/medio/alto) — se envía al equipo
        // de cumplimiento junto con los resultados de los motores de detección
        payload.checks = Object.assign({}, checks, {
            riskAssessment: V.computeRiskScore({
                pepSelf: payload.amlProfile.pepSelf,
                pepFamily: payload.amlProfile.pepFamily,
                foreignTaxResidency: payload.amlProfile.residenciaExtranjera,
                sector: payload.amlProfile.sectorEconomico,
                monthlyVolume: payload.amlProfile.montoMensual,
                sourceOfFunds: payload.amlProfile.origenRecursos,
                thirdParty: !payload.amlProfile.cuentaPropia,
                personType: payload.personType
            })
        });

        var body = JSON.stringify(payload);
        if (body.length > 4.2 * 1024 * 1024) {
            nextBtn.classList.remove('is-busy');
            nextBtn.disabled = false;
            submitError.textContent = 'Tus documentos pesan demasiado en conjunto. Sube versiones más ligeras (fotos en lugar de PDF pesados) e intenta de nuevo.';
            return;
        }

        fetch('/api/onboarding', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: body
        }).then(function (res) {
            if (!res.ok) return res.json().then(function (b) { throw new Error(b.error || 'Error del servidor (' + res.status + ')'); });
            return res.json();
        }).then(function (body) {
            track('completed', { meta: { folio: body.folio } });
            showSuccess(body.folio, body.stored);
        }).catch(function (err) {
            track('submit_error', { meta: { message: err.message } });
            nextBtn.classList.remove('is-busy');
            nextBtn.disabled = false;
            submitError.textContent = 'No pudimos enviar tu solicitud: ' + err.message + '. Intenta de nuevo o escríbenos a direccion@novacoin.mx.';
        });
    }

    function showSuccess(folio, stored) {
        steps.forEach(function (s) { s.hidden = true; });
        controls.hidden = true;
        document.getElementById('onbProgress').hidden = true;
        var success = document.getElementById('onbSuccess');
        success.hidden = false;
        document.getElementById('folioNumber').textContent = folio;
        if (stored === false) {
            document.getElementById('successNote').textContent = 'Recibimos tu solicitud. Guarda tu folio — nuestro equipo te contactará por correo para confirmar tu expediente.';
        }
        try { localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(SESSION_KEY); } catch (e) { /* sin almacenamiento */ }
        stopCamera();
        window.scrollTo({ top: document.getElementById('wizard').offsetTop - 60, behavior: 'smooth' });
    }

    renderStep();
    track('session_start');
});
