import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { createHash, webcrypto } from 'node:crypto';
import { stripTypeScriptTypes, createRequire } from 'node:module';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

// Real handlers/PDF generation, entirely offline: no database, network or real signature.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(import.meta.url);
let pdfLib;
try { pdfLib = require('pdf-lib'); } catch {
  const runtime = resolve(dirname(process.execPath), '../node_modules/pdf-lib');
  pdfLib = require(runtime);
}
const slugs = ['toxina', 'preenchimento', 'intradermoterapia', 'bioestimulador', 'peeling-quimico', 'fios-pdo'];
const legacyHashes = [
  'c4c21544a3e0b7ad9d020ca4e36437dbf7424ff808c1dee7d61542283d33bbf8',
  '4e2fae97c2bc890fabe4b52e11324209cf60ad636fbff07993b7d3f7d8d4e8ad',
  '65c38aa1611a53d5602db4307d8353f508dffc6cd6ab7ada320d2db2db925de4',
  'cf2c0958cc679441b99849ded246d12ee1b9f7aaa102604a441dda1720a66213',
  '3f04db1af1f0e984385862abdd0b1b93ae34ebfd49f09587f541c317022b530b',
  '6a31a13133e29132763e2ded44c6d1a424d64154d0cb883b02628d897924bd24',
];
const questionCounts = [17, 17, 14, 8, 11, 13];
// Frozen from the previous release: editing the manifest must not rewrite history.
const v2Hashes = [
  'a455dc7d5d0f6bc63afef6b02492b2070665092e79f56bf0d4dbddd07273ea66',
  'c08d41af2d0358a064c8cded9b54cf4cd0c32b63b07a953ce25212f87998cab9',
  '4642ac82b2b796fe5782431f8611f4eaf60f985f9ebc29374b10324d9ed74d86',
  '15cfff64ccb226d459c9dad3ff283ee0d1f41d28899d4285bb2f34bbe3666eca',
  '941fbbbfcb0ffc1ccc282f7771a9907f0de6b01f20405e1cade6363d462b0690',
  'c68e4bf913915671063923e25588720c891b5ffdc2e585469373a1f4a9f568e4',
];
const V1 = '2026-08-18-v1', V2 = '2026-10-15-v2', V3 = '2026-10-15-v3';
const legacyVersions = [V1, V2];
const termSuffix = {[V1]: 'v1', [V2]: 'v2', [V3]: 'v3'};
const requiredDeclarations = slug => [
  'leitura', 'informacoes_verdadeiras', 'decisao_voluntaria', 'revisao_profissional',
  ...(slug === 'preenchimento' ? ['risco_vascular', 'ciencia_hialuronidase_urgencia'] : slug === 'toxina' ? [] : ['riscos_especificos']),
];
const normalize = text => text.replace(/\r\n?/g, '\n').trim();
const digest = text => createHash('sha256').update(text).digest('hex');
const shared = stripTypeScriptTypes(await readFile(resolve(root, 'supabase/functions/_shared/tcle-term-versions.ts'), 'utf8')).replace(/^export /gm, '');
const logo = await readFile(resolve(root, 'assets/identidade-visual-transparente-v1.png'));
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z5CEAAAAASUVORK5CYII=', 'base64');
const load = path => readFile(resolve(root, path), 'utf8');
const manifest = JSON.parse(await load('supabase/tests/tcle-term-manifest.json'));

async function harness(slug, previous = null, options = {}) {
  const fn = slug === 'toxina' ? 'tcle-submit' : 'tcle-' + slug + '-submit';
  const original = await load('supabase/functions/' + fn + '/index.ts');
  const source = stripTypeScriptTypes(original.replace(/^import[^;]*;\s*/gm, ''));
  let handler, stored = previous && structuredClone(previous), lookups = 0;
  const calls = [], pdfTexts = [], uploads = new Map(), errors = [];
  const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers: {'content-type': 'application/json'}});
  const bindings = {
    Request, Response, TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, DataView, Date,
    crypto: webcrypto, atob, console: {error: (...args) => errors.push(args)},
    Deno: {env: {get: name => name === 'SUPABASE_URL' ? 'https://offline.invalid' : 'offline-service-key-not-a-secret'}, serve: fn => { handler = fn; }},
    consumePublicFormRateLimit: async () => ({allowed: true}),
    readLimitedBody: async req => new Uint8Array(await req.arrayBuffer()),
    RequestBodyTooLargeError: class extends Error {},
    ...pdfLib,
    PDFDocument: {
      create: async () => {
        const pdf = await pdfLib.PDFDocument.create();
        const addPage = pdf.addPage.bind(pdf);
        pdf.addPage = (...args) => {
          const page = addPage(...args.map(value => Array.isArray(value) ? Array.from(value) : value)), drawText = page.drawText.bind(page);
          page.drawText = (text, ...rest) => { pdfTexts.push(text); return drawText(text, ...rest); };
          return page;
        };
        return pdf;
      },
    },
    fetch: async (url, init = {}) => {
      const method = init.method || 'GET';
      calls.push({url, method, body: init.body});
      if (url.endsWith('/assets/identidade-visual-transparente-v1.png')) return new Response(logo);
      assert(url.startsWith('https://offline.invalid/'), 'Unexpected outbound destination: ' + url);
      if (url.includes('/documentos_clinicos?select=') && url.includes('idempotency_key=')) {
        lookups++;
        const found = options.conflictRecord && lookups === 1 ? null : (options.conflictRecord || stored);
        return json(found ? [found] : []);
      }
      if (url.includes('/documentos_clinicos?select=id&origem_hash=')) return json([]);
      if (url.includes('/storage/v1/object/sign/')) return json([{signedURL: '/object/sign/documentos-clinicos/historical.pdf?token=offline'}]);
      if (url.includes('/documentos_clinicos') && method === 'POST') {
        if (options.conflictRecord) return json({}, 409);
        stored = {...JSON.parse(init.body), id: '00000000-0000-4000-8000-000000000002'};
        return json([stored], 201);
      }
      if (url.includes('/documentos_clinicos?id=') && method === 'PATCH') {
        const update = JSON.parse(init.body);
        if (options.loseRecovery && url.includes('&updated_at=')) return json([]);
        stored = {...stored, ...update};
        return json([stored]);
      }
      if (url.includes('/storage/v1/object/') && method === 'DELETE') return json([]);
      if (url.includes('/storage/v1/object/') && method === 'POST') {
        uploads.set(url, Buffer.from(init.body));
        return json({}, 201);
      }
      throw new Error('Unhandled offline route: ' + method + ' ' + url);
    },
  };
  const config = new Function(...Object.keys(bindings), shared + '\n' + source + '\n;return {type:TYPE, version:TERM_VERSION, hash:TERM_SHA256, questions:HEALTH_QUESTIONS, regions:typeof ALLOWED_REGIONS === "undefined" ? [] : [...ALLOWED_REGIONS], modalities:typeof ALLOWED_MODALITIES === "undefined" ? [] : [...ALLOWED_MODALITIES]};')(...Object.values(bindings));
  return {
    config, calls, pdfTexts, uploads, errors, stored: () => stored,
    run: async payload => {
      const response = await handler(new Request('https://offline.invalid/' + fn, {method: 'POST', headers: {'content-type': 'application/json', origin: 'https://anamariajacob.com.br'}, body: JSON.stringify(payload)}));
      return {status: response.status, body: await response.json()};
    },
  };
}

async function payloadFor(slug, config, version = V3) {
  assert(termSuffix[version], 'Unknown test fixture version');
  const text = normalize(await load('tcle-' + slug + '/termo-' + termSuffix[version] + '.txt'));
  const hash = digest(text), id = '00000000-0000-4000-8000-000000000001';
  const signedAt = new Date(Date.now() - 1_000).toISOString();
  const identification = {nome: 'TESTE Paciente Sintetico', nascimento: '1990-01-01', cpf: '52998224725', telefone: '11999990000', email: 'teste@example.invalid', local_assinatura: 'Teste offline', emergencia: {nome: 'TESTE Contato', relacao: 'Teste', telefone: '11999990001'}};
  return {
    idempotency_key: id, website: '', started_at: new Date(Date.now() - 10_000).toISOString(),
    tipo: config.type, versao_termo: version, termo_sha256: hash, termo_texto: text,
    codigo_verificacao: digest(id + '|' + config.type + '|' + version + '|' + hash),
    nome: identification.nome, cpf: identification.cpf, telefone: identification.telefone, email: identification.email,
    assinado_em_cliente: signedAt, dispositivo: 'offline automated test', assinatura_png_base64: png.toString('base64'), assinatura_sha256: digest(png),
    dados: {
      identificacao: identification,
      procedimento: {finalidade: 'exclusivamente estética', regioes: config.regions.length ? [config.regions[0]] : 'Região de teste', modalidades: config.modalities.length ? [config.modalities[0]] : [], objetivo: 'Objetivo de teste', detalhamento_plano_previsto: 'Planejamento de teste', detalhamento_volume_previsto: 'Volume a avaliar pela profissional', status_anamnese: 'Já preenchi'},
      confirmacoes_saude: Array.from(config.questions, (pergunta, index) => ({numero: index + 1, pergunta, resposta: 'nao', detalhe: ''})),
      observacoes_saude: '', imagem: {foto_prontuario: 'nao', divulgacao: 'nao', antes_depois: 'nao', forma_imagem: 'nao_aplicavel', primeiro_nome: 'nao', depoimento: 'nao'}, duvidas: '',
      declaracoes: {...Object.fromEntries(requiredDeclarations(slug).map(key => [key, true])), ...(version !== V3 ? {tratamento_dados: true} : {})},
      assinatura_digitada: identification.nome, assinatura_metodo: 'nome_digitado', assinado_em_cliente: signedAt, fuso_horario: 'America/Sao_Paulo',
    },
  };
}

const recordFor = (p, overrides = {}) => ({id: '00000000-0000-4000-8000-000000000002', tipo: p.tipo, versao_termo: p.versao_termo, termo_sha256: p.termo_sha256, nome: p.nome, cpf: p.cpf, telefone: p.telefone, status: 'recebido', codigo_verificacao: 'a'.repeat(64), recebido_em: '2026-10-15T20:00:00Z', updated_at: new Date(Date.now() - 5 * 60_000).toISOString(), pdf_path: 'historical/documento.pdf', assinatura_path: 'historical/assinatura.png', ...overrides});

for (const [index, slug] of slugs.entries()) {
  test(slug + ': immutable v1/v2, minimal v3 and consistent manifest/front/backend hashes', async () => {
    const v1 = normalize(await load('tcle-' + slug + '/termo-v1.txt'));
    const v2 = normalize(await load('tcle-' + slug + '/termo-v2.txt'));
    const v3 = normalize(await load('tcle-' + slug + '/termo-v3.txt'));
    assert.equal(digest(v1), legacyHashes[index]);
    assert.equal(digest(v2), v2Hashes[index]);
    const h = await harness(slug);
    assert.equal(h.config.version, V3);
    assert.equal(digest(v3), h.config.hash);
    assert.equal(manifest.currentVersion, V3);
    assert.deepEqual(manifest.documents.map(document => document.slug), slugs);
    const entry = manifest.documents.find(document => document.slug === slug);
    assert.equal(entry.type, h.config.type);
    for (const [version, text] of [[V1, v1], [V2, v2], [V3, v3]]) {
      const item = entry.versions[termSuffix[version]];
      assert.equal(item.version, version);
      assert.equal(item.path, 'tcle-' + slug + '/termo-' + termSuffix[version] + '.txt');
      assert.equal(item.sha256, digest(text));
    }
    const front = await load('tcle-' + slug + '/tcle.js');
    assert(front.includes("TERM_VERSION: '" + V3 + "'"));
    assert(front.includes(h.config.hash));
    assert(front.includes("fetch('termo-v3.txt'"));
    const questionsLiteral = /const HEALTH_QUESTIONS = Object\.freeze\(([\s\S]+?)\);/.exec(front)[1];
    const questions = vm.runInNewContext(questionsLiteral);
    assert.equal(questions.length, questionCounts[index]);
    assert.deepEqual(Array.from(questions), Array.from(h.config.questions));
    const originalQuestions = Array.from(v1.matchAll(/^\d+\) (.+)$/gm), match => match[1]);
    assert.equal(originalQuestions.length, slug === 'toxina' ? 0 : questionCounts[index]);
    for (const question of originalQuestions) assert(questions.includes(question), 'Missing question: ' + question);
    assert.equal((v2.match(/^\d+\) /gm) || []).length, 0);
    assert(v2.includes('Todas as perguntas, respostas e explicações são incluídas na cópia digital, como parte integrante deste documento.'));
    // Every other original paragraph survives verbatim, including warnings and rights.
    for (const paragraph of v1.split(/\n\n+/)) {
      if (/^(?:Versão do documento:|Vigência:|As perguntas|\d+\))/.test(paragraph)) continue;
      assert(v2.includes(paragraph), 'Changed protected paragraph: ' + paragraph.slice(0, 100));
    }
    // v3 only changes the version, adds anamnesis guidance and narrows the final declaration.
    for (const paragraph of v2.split(/\n\n+/)) {
      if (/^(?:Versão do documento:|Ao enviar este documento,|Ao assinar(?: e enviar)?,)/.test(paragraph)) continue;
      assert(v3.includes(paragraph), 'Changed protected v2 paragraph: ' + paragraph.slice(0, 100));
    }
    assert(v3.includes('Este termo não comprova o recebimento da anamnese'));
    assert(v3.includes('questionário específico deste procedimento'));
  });

  for (const version of legacyVersions) {
  test(slug + ': completed ' + termSuffix[version] + ' returns original PDF without regeneration or writes', async () => {
    const base = await harness(slug), p = await payloadFor(slug, base.config, version);
    const previous = recordFor(p), h = await harness(slug, previous);
    const result = await h.run(p);
    assert.equal(result.status, 200);
    assert.equal(result.body.idempotente, true);
    assert.equal(result.body.codigo, previous.codigo_verificacao);
    assert.equal(result.body.recebido_em, previous.recebido_em);
    assert.equal(h.pdfTexts.length, 0);
    assert.equal(h.uploads.size, 0);
    assert.deepEqual(h.stored(), previous);
    assert.equal(h.calls.filter(c => c.method !== 'GET').length, 1, 'Only signing an existing download URL is allowed');
  });

  test(slug + ': ' + termSuffix[version] + ' cannot create new submissions', async () => {
    const h = await harness(slug), p = await payloadFor(slug, h.config, version);
    const result = await h.run(p);
    assert.equal(result.status, 409);
    assert.equal(result.body.codigo_erro, 'term_version_mismatch');
    assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
  });

  test(slug + ': ' + termSuffix[version] + ' recovery refuses another owner, type, version, hash or unknown stored version', async () => {
    const base = await harness(slug), p = await payloadFor(slug, base.config, version);
    const current = await payloadFor(slug, base.config, V3);
    const cases = [
      [recordFor(p), {...p, cpf: '11111111111'}],
      [recordFor(p), {...p, tipo: 'outro_tipo'}],
      [recordFor(p), current],
      [recordFor(p), {...p, termo_sha256: '0'.repeat(64)}],
      [recordFor(p, {termo_sha256: '0'.repeat(64)}), p],
      [recordFor(p, {versao_termo: 'unknown'}), {...p, versao_termo: 'unknown'}],
    ];
    for (const [previous, payload] of cases) {
      const h = await harness(slug, previous), result = await h.run(payload);
      assert.equal(result.status, 409);
      assert.equal(result.body.codigo_erro, 'invalid_idempotency');
      assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
    }
  });

  test(slug + ': interrupted ' + termSuffix[version] + ' resumes with original version, hash and declaration', async () => {
    const base = await harness(slug), p = await payloadFor(slug, base.config, version);
    for (const status of ['erro', 'processando']) {
      const h = await harness(slug, recordFor(p, {status}));
      const result = await h.run(p);
      assert.equal(result.status, 200, JSON.stringify({result, errors: h.errors}));
      assert.equal(h.stored().versao_termo, version);
      assert.equal(h.stored().termo_sha256, p.termo_sha256);
      assert.equal(h.stored().status, 'recebido');
      const pdf = Array.from(h.uploads.entries()).find(([path]) => path.endsWith('/documento.pdf'))[1];
      assert((await pdfLib.PDFDocument.load(pdf)).getPageCount() > 1);
      assert(h.pdfTexts.some(text => text.includes(version)));
      assert(!h.pdfTexts.some(text => text.includes(V3)));
      assert(h.pdfTexts.join(' ').includes(p.termo_sha256));
      assert.equal(h.stored().dados.confirmacoes_saude.length, questionCounts[index]);
      assert.equal(h.stored().dados.declaracoes.tratamento_dados, true);
      const allText = h.pdfTexts.join(' ').replace(/\s+/g, ' ');
      assert(allText.includes('[CONFIRMADO] Está ciente do tratamento de dados'));
      assert(allText.includes('[CONFIRMADO] Declarou que as informações são verdadeiras'));
      assert(!allText.includes('[CONFIRMADO] Declarou que as respostas específicas'));
    }
  });

  test(slug + ': interrupted ' + termSuffix[version] + ' cannot silently fabricate its historical data declaration', async () => {
    const base = await harness(slug), original = await payloadFor(slug, base.config, version);
    for (const value of [undefined, false, null, 'true']) {
      const p = structuredClone(original);
      if (value === undefined) delete p.dados.declaracoes.tratamento_dados;
      else p.dados.declaracoes.tratamento_dados = value;
      const previous = recordFor(original, {status: 'erro'}), h = await harness(slug, previous);
      const result = await h.run(p);
      assert.equal(result.body.codigo_erro, 'invalid_answers');
      assert.equal(h.uploads.size, 0);
      assert.deepEqual(h.stored(), previous);
      assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
    }
  });

  test(slug + ': ' + termSuffix[version] + ' integrity/signature checks and concurrent recovery locks remain enforced', async () => {
    const base = await harness(slug), p = await payloadFor(slug, base.config, version);
    const mutations = [[{...p, termo_texto: p.termo_texto + 'alterado'}, 'term_integrity_failed'], [{...p, assinatura_sha256: '0'.repeat(64)}, 'hash_mismatch']];
    for (const [payload, code] of mutations) {
      const h = await harness(slug, recordFor(p, {status: 'erro'}));
      const result = await h.run(payload);
      assert.equal(result.body.codigo_erro, code);
      assert.equal(h.uploads.size, 0);
    }
    const processing = await harness(slug, recordFor(p, {status: 'processando', updated_at: new Date().toISOString()}));
    assert.equal((await processing.run(p)).body.codigo_erro, 'already_processing');
    assert.equal(processing.uploads.size, 0);
    const lost = await harness(slug, recordFor(p, {status: 'erro'}), {loseRecovery: true});
    assert.equal((await lost.run(p)).body.codigo_erro, 'already_processing');
    assert.equal(lost.uploads.size, 0);
    assert.equal(lost.calls.filter(c => c.method === 'DELETE').length, 0);
  });
  }

  test(slug + ': new v3 saves the complete questionnaire once without the removed declaration', async () => {
    const h = await harness(slug), p = await payloadFor(slug, h.config);
    const result = await h.run(p);
    assert.equal(result.status, 201, JSON.stringify({result, errors: h.errors}));
    assert.equal(h.stored().versao_termo, V3);
    assert.equal(h.stored().termo_sha256, p.termo_sha256);
    assert.equal(h.stored().dados.confirmacoes_saude.length, questionCounts[index]);
    const allText = h.pdfTexts.join(' ').replace(/\s+/g, ' ');
    assert.equal(Object.hasOwn(h.stored().dados.declaracoes, 'tratamento_dados'), false);
    assert.equal(allText.includes('[CONFIRMADO] Está ciente do tratamento de dados'), false);
    assert(allText.includes('[CONFIRMADO] Declarou que as respostas específicas deste procedimento são verdadeiras'));
    assert.deepEqual(h.stored().dados.imagem, p.dados.imagem);
    for (const question of h.config.questions) {
      // The PDF can wrap a question across multiple drawText calls.
      assert.equal(allText.split(question).length - 1, 1, 'Question must appear once: ' + question);
    }
    const pdf = Array.from(h.uploads.entries()).find(([path]) => path.endsWith('/documento.pdf'))[1];
    assert((await pdfLib.PDFDocument.load(pdf)).getPageCount() > 1);
  });

  test(slug + ': v3 rejects removed general declaration even when set to true', async () => {
    for (const value of [true, false, null, 'true']) {
      const h = await harness(slug), p = await payloadFor(slug, h.config);
      p.dados.declaracoes.tratamento_dados = value;
      const result = await h.run(p);
      assert.equal(result.status, 400);
      assert.equal(result.body.codigo_erro, 'invalid_answers');
      assert.equal(h.uploads.size, 0);
      assert.equal(h.stored(), null);
      assert.equal(h.calls.filter(c => c.method !== 'GET').length, 0);
    }
  });

  test(slug + ': v3 still requires every procedure declaration explicitly', async () => {
    for (const key of requiredDeclarations(slug)) {
      for (const value of [undefined, false, 'true']) {
        const h = await harness(slug), p = await payloadFor(slug, h.config);
        if (value === undefined) delete p.dados.declaracoes[key];
        else p.dados.declaracoes[key] = value;
        const result = await h.run(p);
        assert.equal(result.body.codigo_erro, 'invalid_answers', key + ': ' + String(value));
        assert.equal(h.uploads.size, 0);
        assert.equal(h.stored(), null);
      }
    }
  });

  test(slug + ': v3 clinical photo permission is independent of publishing and refuses contradictory permissions', async () => {
    const h = await harness(slug), p = await payloadFor(slug, h.config);
    p.dados.imagem.foto_prontuario = 'sim';
    assert.equal((await h.run(p)).status, 201);
    assert.deepEqual(h.stored().dados.imagem, p.dados.imagem);
    assert.equal(h.stored().dados.imagem.divulgacao, 'nao');
    for (const [key, value] of [['antes_depois', 'sim'], ['primeiro_nome', 'sim'], ['depoimento', 'sim'], ['forma_imagem', 'rosto_inteiro'], ['foto_prontuario', true]]) {
      const invalid = await harness(slug), mutation = await payloadFor(slug, invalid.config);
      mutation.dados.imagem[key] = value;
      assert.equal((await invalid.run(mutation)).body.codigo_erro, 'invalid_answers', key);
      assert.equal(invalid.uploads.size, 0);
      assert.equal(invalid.stored(), null);
    }
  });

  test(slug + ': insert conflict reuses only the same current-version document', async () => {
    const base = await harness(slug), p = await payloadFor(slug, base.config);
    const h = await harness(slug, null, {conflictRecord: recordFor(p)});
    const result = await h.run(p);
    assert.equal(result.status, 200);
    assert.equal(result.body.idempotente, true);
    assert.equal(h.uploads.size, 0);
    const old = await payloadFor(slug, base.config, V1);
    const mismatch = await harness(slug, null, {conflictRecord: recordFor(old)});
    assert.equal((await mismatch.run(p)).body.codigo_erro, 'invalid_idempotency');
    assert.equal(mismatch.uploads.size, 0);
  });
}
