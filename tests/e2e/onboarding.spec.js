// E2E del flujo de onboarding KYC. Los CDN de OCR/rostro se bloquean para que
// las pruebas sean deterministas: el wizard degrada a "revisión manual" sin bloquear.
const { test, expect } = require('@playwright/test');

const PAGES = ['novacoin', 'novacore', 'novapay', 'rfq', 'walletchecker'];

const DATA = {
    nombre: 'Juan Carlos', apellidoPaterno: 'Pérez', apellidoMaterno: 'García',
    fechaNacimiento: '1985-03-15', ocupacion: 'Comerciante',
    telefono: '3312345678', correo: 'juan.perez@example.com',
    calle: 'Av. Revolución', numExt: '123', colonia: 'Centro', cp: '44100',
    ciudad: 'Guadalajara', estado: 'Jalisco',
    rfc: 'PEGJ850315ABA', curp: 'PEGJ850315HJCRRN06', clabe: '032180000118359719'
};

// Genera un JPEG real (>5KB) con canvas dentro del navegador — sin fixtures binarios
async function makeJpeg(page, label) {
    const dataUrl = await page.evaluate((txt) => {
        const c = document.createElement('canvas');
        c.width = 800; c.height = 500;
        const ctx = c.getContext('2d');
        for (let i = 0; i < 400; i++) {
            ctx.fillStyle = 'rgb(' + (Math.random() * 255 | 0) + ',' + (Math.random() * 255 | 0) + ',' + (Math.random() * 255 | 0) + ')';
            ctx.fillRect(Math.random() * 800, Math.random() * 500, 40, 40);
        }
        ctx.fillStyle = '#fff'; ctx.font = '30px sans-serif';
        ctx.fillText(txt, 40, 60);
        return c.toDataURL('image/jpeg', 0.9);
    }, label);
    return {
        name: label.toLowerCase().replace(/\s+/g, '-') + '.jpg',
        mimeType: 'image/jpeg',
        buffer: Buffer.from(dataUrl.split(',')[1], 'base64')
    };
}

function blockCdns(page) {
    return page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
}

async function next(page) {
    await page.getByTestId('next-btn').click();
}

test.describe('Botones de onboarding en todo el sitio', () => {
    for (const p of PAGES) {
        test(`la página ${p} tiene CTA de onboarding`, async ({ page }) => {
            await page.goto(`/${p}/`);
            const hero = page.getByTestId('onboarding-cta');
            await expect(hero).toBeVisible();
            await expect(hero).toHaveAttribute('href', /\.\.\/onboarding\//);
            // link del nav (visible en desktop, dentro del menú en móvil)
            expect(await page.locator('a.nav__link[href="../onboarding/"]').count()).toBeGreaterThan(0);
            // botón en la sección CTA final
            expect(await page.locator('.cta__btns a[href="../onboarding/"]').count()).toBeGreaterThan(0);
        });
    }

    test('el CTA del hero navega a la página de onboarding', async ({ page }) => {
        await page.goto('/novacoin/');
        await page.getByTestId('onboarding-cta').click();
        await expect(page).toHaveURL(/\/onboarding\//);
        await expect(page.locator('h1')).toContainText('Realiza tu onboarding');
    });
});

test.describe('Wizard de onboarding', () => {
    test.beforeEach(async ({ page }) => {
        await blockCdns(page);
        await page.goto('/onboarding/');
        await page.evaluate(() => localStorage.clear());
    });

    test('flujo completo feliz: Novacore + NovaPay simultáneos, persona física, hasta el folio', async ({ page }) => {
        // Paso 0 — plataformas (selección múltiple)
        await page.getByTestId('platform-novacore').click();
        await page.getByTestId('platform-novapay').click();
        await next(page);

        // Paso 1 — datos generales (+ negocio por NovaPay)
        await expect(page.locator('#novapayFields')).toBeVisible();
        await page.fill('#nombreComercial', 'Taquería La Nova');
        await page.fill('#giroNegocio', 'Restaurante');
        await page.fill('#nombre', DATA.nombre);
        await page.fill('#apellidoPaterno', DATA.apellidoPaterno);
        await page.fill('#apellidoMaterno', DATA.apellidoMaterno);
        await page.fill('#fechaNacimiento', DATA.fechaNacimiento);
        await page.fill('#ocupacion', DATA.ocupacion);
        await next(page);

        // Paso 2 — contacto
        await page.fill('#telefono', DATA.telefono);
        await page.fill('#correo', DATA.correo);
        await next(page);

        // Paso 3 — domicilio + comprobante
        await page.fill('#calle', DATA.calle);
        await page.fill('#numExt', DATA.numExt);
        await page.fill('#colonia', DATA.colonia);
        await page.fill('#cp', DATA.cp);
        await page.fill('#ciudad', DATA.ciudad);
        await page.selectOption('#estado', DATA.estado);
        await page.setInputFiles('#fileComprobante', await makeJpeg(page, 'Comprobante CFE'));
        await expect(page.locator('[data-upload="comprobante"] .upload-preview')).toBeVisible();
        await next(page);

        // Paso 4 — fiscales (CLABE visible porque eligió Novacore)
        await page.fill('#rfc', DATA.rfc);
        await page.fill('#curp', DATA.curp);
        await page.selectOption('#regimenFiscal', '612');
        await expect(page.locator('#clabeField')).toBeVisible();
        await page.fill('#clabe', DATA.clabe);
        await next(page);

        // Paso 5 — perfil transaccional AML + comprobante de ingresos
        await page.selectOption('#origenRecursos', 'negocio_propio');
        await page.selectOption('#sectorEconomico', 'comercio');
        await page.selectOption('#usoCuenta', 'dispersiones_nomina');
        await page.selectOption('#montoMensual', '20k_100k');
        await page.selectOption('#opsMensuales', '6_20');
        await page.check('input[name="pepSelf"][value="no"]');
        await page.check('input[name="pepFamily"][value="no"]');
        await page.check('input[name="cuentaPropia"][value="si"]');
        await page.check('input[name="residenciaExtranjera"][value="no"]');
        await page.setInputFiles('#fileIngresos', await makeJpeg(page, 'Recibo Nomina'));
        await expect(page.locator('[data-upload="ingresos"] .upload-preview')).toBeVisible();
        await next(page);

        // Paso 6 — referencias
        await page.fill('#ref1Nombre', 'María López');
        await page.fill('#ref1Telefono', '3398765432');
        await page.selectOption('#ref1Relacion', 'Familiar');
        await page.fill('#ref2Nombre', 'Pedro Ramírez');
        await page.fill('#ref2Telefono', '5512345678');
        await page.selectOption('#ref2Relacion', 'Amistad');
        await next(page);

        // Paso 7 — INE
        await page.setInputFiles('#fileIneFrente', await makeJpeg(page, 'INE Frente'));
        await expect(page.locator('[data-upload="ineFrente"] .upload-preview')).toBeVisible();
        await page.setInputFiles('#fileIneReverso', await makeJpeg(page, 'INE Reverso'));
        await expect(page.locator('[data-upload="ineReverso"] .upload-preview')).toBeVisible();
        await next(page);

        // Paso 8 — selfie (subida de archivo)
        await page.setInputFiles('#fileSelfie', await makeJpeg(page, 'Selfie con INE'));
        await expect(page.locator('[data-upload-preview="selfie"]')).toBeVisible();
        await next(page);

        // Paso 9 — revisión
        const review = page.getByTestId('review-summary');
        await expect(review).toContainText('Novacore, NovaPay');
        await expect(review).toContainText('Taquería La Nova');
        await expect(review).toContainText('Juan Carlos Pérez García');
        await expect(review).toContainText(DATA.rfc);
        await expect(review).toContainText('Perfil transaccional');
        await expect(review).toContainText('Negocio propio');
        await expect(review).toContainText('✓ Comprobante de ingresos');
        await expect(review).toContainText('✓ Selfie con INE');
        await page.getByTestId('consent-privacy').check();
        await page.getByTestId('consent-truth').check();
        await next(page);

        // Éxito — la API del server respondió con folio
        await expect(page.getByTestId('success-screen')).toBeVisible({ timeout: 15000 });
        await expect(page.getByTestId('folio')).toHaveText(/^NC-/);
    });

    test('no avanza sin plataforma seleccionada', async ({ page }) => {
        await next(page);
        await expect(page.locator('[data-error-for="platform"]')).toContainText('al menos una plataforma');
        await expect(page.locator('.onb-step[data-step="0"]')).toBeVisible();
    });

    test('los campos por producto aparecen según la selección', async ({ page }) => {
        // NovaPay solo → campos de negocio sí, CLABE no
        await page.getByTestId('platform-novapay').click();
        await next(page);
        await expect(page.locator('#novapayFields')).toBeVisible();
        await page.evaluate(() => {
            document.querySelectorAll('.onb-step').forEach((s) => { s.hidden = s.dataset.step !== '4'; });
        });
        await expect(page.locator('#clabeField')).toBeHidden();
        // agregar Novacore → aparece CLABE
        await page.evaluate(() => {
            const c = document.querySelector('input[name="platforms"][value="novacore"]');
            c.checked = true;
            c.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await expect(page.locator('#clabeField')).toBeVisible();
    });

    test('rechaza RFC con dígito verificador inválido y acepta el correcto', async ({ page }) => {
        await page.getByTestId('platform-rfq').click();
        await next(page);
        await page.fill('#nombre', DATA.nombre);
        await page.fill('#apellidoPaterno', DATA.apellidoPaterno);
        await page.fill('#fechaNacimiento', DATA.fechaNacimiento);
        await page.fill('#ocupacion', DATA.ocupacion);
        await next(page);
        await page.fill('#telefono', DATA.telefono);
        await page.fill('#correo', DATA.correo);
        await next(page);
        await page.fill('#calle', DATA.calle);
        await page.fill('#numExt', DATA.numExt);
        await page.fill('#colonia', DATA.colonia);
        await page.fill('#cp', DATA.cp);
        await page.fill('#ciudad', DATA.ciudad);
        await page.selectOption('#estado', DATA.estado);
        await page.setInputFiles('#fileComprobante', await makeJpeg(page, 'Comprobante'));
        await expect(page.locator('[data-upload="comprobante"] .upload-preview')).toBeVisible();
        await next(page);

        // dígito verificador alterado
        await page.fill('#rfc', 'PEGJ850315ABB');
        await page.fill('#curp', DATA.curp);
        await page.selectOption('#regimenFiscal', '605');
        await next(page);
        await expect(page.locator('[data-error-for="rfc"]')).toContainText('Dígito verificador');
        // RFQ no pide CLABE
        await expect(page.locator('#clabeField')).toBeHidden();

        // se corrige y valida en vivo
        await page.fill('#rfc', DATA.rfc);
        await page.locator('#rfc').blur();
        await expect(page.locator('#rfcCheck')).toContainText('RFC válido');
        await next(page);
        await expect(page.locator('.onb-step[data-step="5"]')).toBeVisible();

        // el paso AML no avanza sin responder el perfil transaccional
        await next(page);
        await expect(page.locator('[data-error-for="origenRecursos"]')).toContainText('origen');
        await expect(page.locator('[data-error-for="pepSelf"]')).toContainText('cargos públicos');
    });

    test('preguntas AML muestran campos condicionales (PEP, beneficiario, FATCA)', async ({ page }) => {
        await page.getByTestId('platform-rfq').click();
        await next(page);
        await page.evaluate(() => {
            document.querySelectorAll('.onb-step').forEach((s) => { s.hidden = s.dataset.step !== '5'; });
        });
        await page.check('input[name="pepSelf"][value="si"]');
        await expect(page.locator('#pepDetail')).toBeVisible();
        await page.check('input[name="pepSelf"][value="no"]');
        await expect(page.locator('#pepDetail')).toBeHidden();
        await page.check('input[name="cuentaPropia"][value="no"]');
        await expect(page.locator('#beneficiaryDetail')).toBeVisible();
        await page.check('input[name="residenciaExtranjera"][value="si"]');
        await expect(page.locator('#foreignDetail')).toBeVisible();
    });

    test('persona moral exige documentos corporativos en el paso de identificación', async ({ page }) => {
        await page.getByTestId('platform-novacore').click();
        await next(page);
        await page.selectOption('#personType', 'moral');
        await page.evaluate(() => {
            document.querySelectorAll('.onb-step').forEach((s) => { s.hidden = s.dataset.step !== '7'; });
        });
        await expect(page.locator('#moralDocs')).toBeVisible();
        await expect(page.getByTestId('upload-acta')).toBeVisible();
        await expect(page.getByTestId('upload-csf')).toBeVisible();
        // persona física no los ve (el campo vive en un paso oculto: cambio por JS)
        await page.evaluate(() => {
            const s = document.getElementById('personType');
            s.value = 'fisica';
            s.dispatchEvent(new Event('change', { bubbles: true }));
        });
        await expect(page.locator('#moralDocs')).toBeHidden();
    });

    test('rechaza CURP incongruente con el RFC', async ({ page }) => {
        await page.getByTestId('platform-rfq').click();
        await next(page);
        await page.fill('#nombre', DATA.nombre);
        await page.fill('#apellidoPaterno', DATA.apellidoPaterno);
        await page.fill('#fechaNacimiento', DATA.fechaNacimiento);
        await page.fill('#ocupacion', DATA.ocupacion);
        await next(page);
        await page.fill('#telefono', DATA.telefono);
        await page.fill('#correo', DATA.correo);
        await next(page);
        await page.fill('#calle', DATA.calle);
        await page.fill('#numExt', DATA.numExt);
        await page.fill('#colonia', DATA.colonia);
        await page.fill('#cp', DATA.cp);
        await page.fill('#ciudad', DATA.ciudad);
        await page.selectOption('#estado', DATA.estado);
        await page.setInputFiles('#fileComprobante', await makeJpeg(page, 'Comprobante'));
        await expect(page.locator('[data-upload="comprobante"] .upload-preview')).toBeVisible();
        await next(page);

        await page.fill('#rfc', DATA.rfc);
        // CURP válida en sí misma pero de otra fecha (860315): dígito recalculado
        await page.fill('#curp', 'PEGJ860315HJCRRN0' + await page.evaluate(() => {
            const a = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
            const s = 'PEGJ860315HJCRRN0';
            let sum = 0;
            for (let i = 0; i < 17; i++) sum += a.indexOf(s[i]) * (18 - i);
            return (10 - (sum % 10)) % 10;
        }));
        await page.selectOption('#regimenFiscal', '605');
        await next(page);
        await expect(page.locator('[data-error-for="curp"]')).toContainText('no coinciden');
    });

    test('valida teléfono, correo y mayoría de edad', async ({ page }) => {
        await page.getByTestId('platform-rfq').click();
        await next(page);
        // menor de edad
        await page.fill('#nombre', DATA.nombre);
        await page.fill('#apellidoPaterno', DATA.apellidoPaterno);
        await page.fill('#fechaNacimiento', '2015-01-01');
        await page.fill('#ocupacion', DATA.ocupacion);
        await next(page);
        await expect(page.locator('[data-error-for="fechaNacimiento"]')).toContainText('mayor de 18');
        await page.fill('#fechaNacimiento', DATA.fechaNacimiento);
        await next(page);
        // teléfono corto y correo con typo
        await page.fill('#telefono', '12345');
        await page.fill('#correo', 'juan@gmial.com');
        await next(page);
        await expect(page.locator('[data-error-for="telefono"]')).toContainText('10 dígitos');
        await expect(page.locator('#emailSuggestion')).toContainText('gmail.com');
        await page.fill('#telefono', DATA.telefono);
        await page.fill('#correo', DATA.correo);
        await next(page);
        await expect(page.locator('.onb-step[data-step="3"]')).toBeVisible();
    });

    test('persona moral oculta CURP y pide razón social', async ({ page }) => {
        await page.getByTestId('platform-novacore').click();
        await next(page);
        await page.selectOption('#personType', 'moral');
        await expect(page.locator('#moralFields')).toBeVisible();
        await next(page);
        await expect(page.locator('[data-error-for="razonSocial"]')).toContainText('razón social');
        await page.fill('#razonSocial', 'Nova Pruebas S.A. de C.V.');
        await page.fill('#nombre', DATA.nombre);
        await page.fill('#apellidoPaterno', DATA.apellidoPaterno);
        await page.fill('#fechaNacimiento', DATA.fechaNacimiento);
        await page.fill('#ocupacion', 'Representante legal');
        await next(page);
        await expect(page.locator('.onb-step[data-step="2"]')).toBeVisible();
    });

    test('guarda borrador y lo restaura al recargar', async ({ page }) => {
        await page.getByTestId('platform-rfq').click();
        await next(page);
        await page.fill('#nombre', 'Borrador');
        await page.fill('#apellidoPaterno', 'Persistente');
        await page.dispatchEvent('#apellidoPaterno', 'change');
        await page.reload();
        await expect(page.locator('#nombre')).toHaveValue('Borrador');
        await expect(page.locator('#apellidoPaterno')).toHaveValue('Persistente');
    });

    test('rechaza archivos que no son documentos válidos', async ({ page }) => {
        await page.getByTestId('platform-rfq').click();
        await next(page);
        // saltar directo al paso 3 llenando lo mínimo
        await page.fill('#nombre', DATA.nombre);
        await page.fill('#apellidoPaterno', DATA.apellidoPaterno);
        await page.fill('#fechaNacimiento', DATA.fechaNacimiento);
        await page.fill('#ocupacion', DATA.ocupacion);
        await next(page);
        await page.fill('#telefono', DATA.telefono);
        await page.fill('#correo', DATA.correo);
        await next(page);
        await page.setInputFiles('#fileComprobante', {
            name: 'nota.txt', mimeType: 'text/plain', buffer: Buffer.from('x'.repeat(10000))
        });
        await expect(page.locator('[data-error-for="fileComprobante"]')).toContainText('Solo se aceptan');
    });
});

test.describe('API de onboarding', () => {
    test('rechaza payload inválido con 422 y detalles', async ({ request }) => {
        const res = await request.post('/api/onboarding', { data: { platform: 'x' } });
        expect(res.status()).toBe(422);
        const body = await res.json();
        expect(body.error).toBe('Datos inválidos');
        expect(body.details.length).toBeGreaterThan(3);
        expect(body.details.join(' ')).toContain('Perfil transaccional');
        expect(body.details.join(' ')).toContain('ingresos');
    });

    test('rechaza métodos distintos de POST', async ({ request }) => {
        const res = await request.get('/api/onboarding');
        expect(res.status()).toBe(405);
    });
});

test.describe('API de tracking de prospectos', () => {
    test('acepta eventos válidos', async ({ request }) => {
        const res = await request.post('/api/track', {
            data: { sessionId: 'test-session-12345', event: 'session_start', step: 0, platforms: ['rfq'], docs: [] }
        });
        expect(res.status()).toBe(200);
        const body = await res.json();
        expect(body.ok).toBe(true);
    });

    test('rechaza eventos inválidos', async ({ request }) => {
        const res = await request.post('/api/track', { data: { sessionId: 'x', event: 'hackeo' } });
        expect(res.status()).toBe(422);
    });

    test('el wizard emite eventos de telemetría', async ({ page }) => {
        const tracked = [];
        await page.route('**/api/track', async (route) => {
            tracked.push(JSON.parse(route.request().postData() || '{}'));
            await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"stored":false}' });
        });
        await page.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
        await page.goto('/onboarding/');
        await page.getByTestId('platform-rfq').click();
        await page.getByTestId('next-btn').click();
        await expect(page.locator('.onb-step[data-step="1"]')).toBeVisible();
        await expect.poll(() => tracked.map((t) => t.event)).toContain('session_start');
        await expect.poll(() => tracked.map((t) => t.event)).toContain('step_complete');
        expect(tracked[0].sessionId).toBeTruthy();
    });
});

test.describe('Dashboard de administración', () => {
    test('exige clave y rechaza claves inválidas', async ({ page }) => {
        await page.goto('/admin/');
        await page.getByTestId('admin-key').fill('clave-incorrecta');
        await page.getByTestId('admin-login').click();
        await expect(page.getByTestId('admin-status')).toContainText('Clave inválida');
    });

    test('con la clave correcta muestra el panel', async ({ page }) => {
        await page.goto('/admin/');
        await page.getByTestId('admin-key').fill('test-admin-key');
        await page.getByTestId('admin-login').click();
        // sin DB configurada en pruebas: el panel avisa pero autentica
        await expect(page.getByTestId('admin-status')).toContainText('base de datos no está configurada');
    });

    test('la API admin rechaza sin clave', async ({ request }) => {
        const res = await request.get('/api/admin');
        expect(res.status()).toBe(401);
    });
});
