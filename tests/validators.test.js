/* Pruebas unitarias del motor de validación KYC — se corren con `node tests/validators.test.js` */
const assert = require('assert');
const V = require('../onboarding/validators.js');

let passed = 0, failed = 0;
function t(name, fn) {
    try { fn(); passed++; console.log('  ✓', name); }
    catch (e) { failed++; console.error('  ✗', name, '—', e.message); }
}

console.log('RFC');
t('acepta RFC física válido', () => assert.ok(V.validateRFC('PEGJ850315ABA').valid));
t('detecta tipo persona física', () => assert.strictEqual(V.validateRFC('PEGJ850315ABA').type, 'fisica'));
t('acepta RFC moral válido', () => assert.strictEqual(V.validateRFC('NOV210101AB1').type, 'moral'));
t('rechaza dígito verificador incorrecto', () => assert.ok(!V.validateRFC('PEGJ850315ABB').valid));
t('rechaza longitud inválida', () => assert.ok(!V.validateRFC('PEGJ8503').valid));
t('rechaza mes inválido', () => assert.ok(!V.validateRFC('PEGJ851315ABA').valid));
t('rechaza palabra prohibida', () => assert.ok(!V.validateRFC('BUEI850315AB1').valid));
t('normaliza espacios y guiones', () => assert.ok(V.validateRFC(' pegj-850315-aba ').valid));
t('rechaza vacío', () => assert.ok(!V.validateRFC('').valid));

console.log('CURP');
t('acepta CURP válida', () => assert.ok(V.validateCURP('PEGJ850315HJCRRN06').valid));
t('rechaza dígito verificador incorrecto', () => assert.ok(!V.validateCURP('PEGJ850315HJCRRN07').valid));
t('rechaza estado inexistente', () => assert.ok(!V.validateCURP('PEGJ850315HXXRRN06').valid));
t('rechaza longitud incorrecta', () => assert.ok(!V.validateCURP('PEGJ850315HJC').valid));

console.log('Cruce RFC/CURP');
t('acepta par congruente', () => assert.ok(V.crossCheckRfcCurp('PEGJ850315ABA', 'PEGJ850315HJCRRN06').valid));
t('rechaza fechas distintas', () => assert.ok(!V.crossCheckRfcCurp('PEGJ860315ABA', 'PEGJ850315HJCRRN06').valid));
t('rechaza iniciales distintas', () => assert.ok(!V.crossCheckRfcCurp('LOMJ850315ABA', 'PEGJ850315HJCRRN06').valid));

console.log('CLABE');
t('acepta CLABE válida', () => assert.ok(V.validateCLABE('032180000118359719').valid));
t('rechaza dígito de control incorrecto', () => assert.ok(!V.validateCLABE('032180000118359718').valid));
t('rechaza longitud incorrecta', () => assert.ok(!V.validateCLABE('0321800001').valid));

console.log('Teléfono');
t('acepta 10 dígitos', () => assert.ok(V.validatePhone('3312345678').valid));
t('normaliza +52 y formato', () => assert.strictEqual(V.validatePhone('+52 (33) 1234-5678').e164, '+523312345678'));
t('rechaza 9 dígitos', () => assert.ok(!V.validatePhone('331234567').valid));
t('rechaza dígitos repetidos', () => assert.ok(!V.validatePhone('1111111111').valid));

console.log('Correo');
t('acepta correo válido', () => assert.ok(V.validateEmail('juan@example.com').valid));
t('sugiere corrección de typo', () => assert.strictEqual(V.validateEmail('juan@gmial.com').suggestion, 'juan@gmail.com'));
t('rechaza sin dominio', () => assert.ok(!V.validateEmail('juan@').valid));

console.log('Fecha de nacimiento');
t('acepta mayor de edad', () => assert.ok(V.validateBirthdate('1985-03-15', '2026-08-15').valid));
t('rechaza menor de edad', () => assert.ok(!V.validateBirthdate('2015-03-15', '2026-08-15').valid));
t('calcula edad correcta', () => assert.strictEqual(V.validateBirthdate('1985-03-15', '2026-08-15').age, 41));

console.log('CP y nombre');
t('acepta CP de 5 dígitos', () => assert.ok(V.validateCP('44100').valid));
t('rechaza CP corto', () => assert.ok(!V.validateCP('441').valid));
t('acepta nombre con acentos', () => assert.ok(V.validateName('María José Ñuño').valid));
t('rechaza nombre con números', () => assert.ok(!V.validateName('Juan123').valid));

console.log('Detección OCR');
t('reconoce texto de INE', () => {
    const r = V.analyzeIneText('INSTITUTO NACIONAL ELECTORAL CREDENCIAL PARA VOTAR NOMBRE PEREZ GARCIA JUAN DOMICILIO CURP PEGJ850315HJCRRN06');
    assert.ok(r.isLikelyINE);
    assert.strictEqual(r.curp, 'PEGJ850315HJCRRN06');
});
t('no marca texto ajeno como INE', () => assert.ok(!V.analyzeIneText('factura de luz bimestre').isLikelyINE));
t('reconoce comprobante CFE', () => assert.ok(V.analyzeProofOfAddressText('CFE Comisión Federal de Electricidad CP 44100').isLikelyProof));
t('coincidencia de nombre en OCR', () => assert.ok(V.nameMatchScore('Juan Pérez García', 'NOMBRE: PEREZ GARCIA JUAN') === 1));

console.log('Comprobante de ingresos');
t('reconoce recibo de nómina', () => assert.ok(V.analyzeIncomeProofText('RECIBO DE PAGO PERCEPCIONES DEDUCCIONES SUELDO').isLikelyIncomeProof));
t('reconoce estado de cuenta bancario', () => assert.ok(V.analyzeIncomeProofText('BBVA ESTADO DE CUENTA SALDO PROMEDIO').isLikelyIncomeProof));
t('no marca texto ajeno como ingreso', () => assert.ok(!V.analyzeIncomeProofText('lista del supermercado').isLikelyIncomeProof));

console.log('Scoring de riesgo AML');
t('perfil simple es riesgo bajo', () => {
    const r = V.computeRiskScore({ sourceOfFunds: 'sueldo', sector: 'tecnologia', monthlyVolume: 'menos_20k', personType: 'fisica' });
    assert.strictEqual(r.level, 'bajo');
});
t('PEP directa es riesgo alto', () => {
    const r = V.computeRiskScore({ pepSelf: true, monthlyVolume: '100k_500k' });
    assert.strictEqual(r.level, 'alto');
    assert.ok(r.reasons.includes('PEP directa'));
});
t('sector de alto riesgo + volumen alto = medio o alto', () => {
    const r = V.computeRiskScore({ sector: 'juegos_apuestas', monthlyVolume: 'mas_500k' });
    assert.ok(r.level !== 'bajo');
});
t('operar por cuenta de tercero sube el riesgo', () => {
    const r = V.computeRiskScore({ thirdParty: true, sourceOfFunds: 'efectivo' });
    assert.ok(r.score >= 40);
});
t('residencia extranjera suma puntos', () => {
    const r = V.computeRiskScore({ foreignTaxResidency: true });
    assert.strictEqual(r.score, 15);
});

console.log('\n' + passed + ' pruebas pasaron, ' + failed + ' fallaron');
process.exit(failed ? 1 : 0);
