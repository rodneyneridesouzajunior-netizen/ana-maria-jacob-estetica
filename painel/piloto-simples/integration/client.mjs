import { assertNetworkAllowed } from './config.mjs';
import { IntegrationError } from './errors.mjs';

// Explicit allowlist: never accept arbitrary endpoints, arbitrary actions,
// service-role credentials or direct database/storage writes from the browser.
const reads = (actions) => Object.fromEntries(actions.map(action => [action, 'read']));
const writes = (actions) => Object.fromEntries(actions.map(action => [action, 'write']));
export const ENDPOINT_ACTIONS = Object.freeze({
  'financeiro-fichas': Object.freeze({
    ...reads(['resumo','listar_lancamentos','listar_clientes','obter_cliente','listar_catalogos','listar_estoque']),
    ...writes(['criar_cliente','editar_cliente','criar_lancamento','programar_parcelas','registrar_pagamento','estornar_pagamento','cancelar_lancamento']),
  }),
  'agenda-fichas': Object.freeze({ listar:'agenda-sync', ...writes(['criar','atualizar','marcar_status']) }),
  'prontuario-fichas': Object.freeze({
    ...reads(['listar','listar_fotos']),
    ...writes(['criar_atualizar','finalizar','adicionar_foto']),
  }),
  'operacao-clinica-fichas': Object.freeze(reads(['listar'])),
  'painel-fichas': Object.freeze({ listar:'read' }),
  'foto-marcacoes-fichas': Object.freeze({abrir:'read',salvar:'write'}),
});

export function createEdgeClient({ config, session, fetchImpl = globalThis.fetch }) {
  const pending = new Set();
  const unsubscribe = session.subscribe(() => { for (const controller of pending) controller.abort(); });
  let disposed = false;
  async function request(endpoint, action, payload = {}, { multipart = false } = {}) {
    if (disposed) throw new IntegrationError('client_closed', 'A área privada foi fechada.');
    const kind = ENDPOINT_ACTIONS[endpoint]?.[action];
    if (!kind) throw new IntegrationError('unsupported_operation', 'Esta operação ainda não tem contrato integrado.');
    const write = kind === 'write';
    assertNetworkAllowed(config, { write, agendaSync: kind === 'agenda-sync' });
    if (multipart && !(payload instanceof FormData)) throw new IntegrationError('invalid_payload', 'Arquivo de envio inválido.');
    if (!multipart && (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
        Object.prototype.hasOwnProperty.call(payload, 'acao'))) {
      throw new IntegrationError('invalid_payload', 'O contrato da operação é inválido.');
    }
    // Capture the request before awaiting credentials: later UI edits cannot
    // change the operation in flight. FormData is copied with immutable Files.
    let body;
    if (multipart) {
      body = new FormData();
      for (const [key, value] of payload.entries()) { if (key !== 'acao') body.append(key, value); }
      body.set('acao', action);
    } else body = JSON.stringify({ ...payload, acao: action });
    const auth = await session.requireReady();
    const controller = new AbortController();
    pending.add(controller);
    let timeout = false;
    const timer = setTimeout(() => { timeout = true; controller.abort(); }, config.timeoutMs);
    const headers = { Authorization: `Bearer ${auth.token}`, apikey: config.publishableKey, Accept: 'application/json' };
    if (!multipart) headers['Content-Type'] = 'application/json';
    try {
      const response = await fetchImpl(`${config.supabaseUrl}/functions/v1/${endpoint}`, {
        method:'POST', headers, body, signal:controller.signal, credentials:'omit',
        cache:'no-store', redirect:'error', referrerPolicy:'no-referrer',
      });
      await session.assertCurrent(auth);
      let result;
      try { result = await response.json(); } catch {
        throw new IntegrationError('invalid_response', 'O serviço retornou uma resposta inesperada.', { status: response.status, uncertain: write });
      }
      await session.assertCurrent(auth);
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new IntegrationError('invalid_response', 'O serviço retornou uma resposta inesperada.', { uncertain: write });
      }
      if (!response.ok || result.ok === false || result.erro) {
        const code = typeof result.codigo === 'string' && /^[a-z0-9_]{1,80}$/i.test(result.codigo)
          ? result.codigo : `http_${response.status}`;
        if (response.status === 401 || response.status === 403) session.invalidate(code);
        const message = response.status === 401 ? 'A sessão não foi aceita pelo servidor. Entre novamente.'
          : response.status === 403 ? 'Acesso negado pelo servidor. Confira a conta administradora, MFA e origem.'
          : response.status === 409 ? 'Há conflito ou duplicidade. Recarregue e confira o registro antes de tentar novamente.'
          : typeof result.erro === 'string' ? result.erro.slice(0, 400)
          : 'O serviço não conseguiu concluir a operação.';
        throw new IntegrationError(code, message, { status: response.status, uncertain: write && response.status >= 500 });
      }
      if (result.auth_method !== 'supabase_auth' || result.role !== 'owner') {
        session.invalidate('unexpected_auth_context');
        throw new IntegrationError('unexpected_auth_context', 'O serviço não confirmou o acesso individual de administrador.');
      }
      return result;
    } catch (error) {
      if (error instanceof IntegrationError) throw error;
      throw new IntegrationError(timeout ? 'timeout' : 'connection_failed',
        write ? 'O envio não foi confirmado. Confira o registro antes de repetir; uma resposta perdida não significa que a gravação falhou.'
          : 'Não foi possível consultar o serviço. Confira a conexão, a origem e a política de rede deste ambiente.',
        { uncertain: write });
    } finally { clearTimeout(timer); pending.delete(controller); }
  }
  return Object.freeze({ request, dispose() { disposed = true; unsubscribe(); for (const c of pending) c.abort(); pending.clear(); } });
}
