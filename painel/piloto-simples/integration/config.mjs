import { IntegrationError } from './errors.mjs';
import { PUBLIC_BACKEND } from './public-backend.mjs';

export const ALLOWED_ORIGINS = Object.freeze([
  'https://anamariajacob.com.br', 'https://www.anamariajacob.com.br',
  'http://127.0.0.1:8765', 'http://localhost:8765',
]);

// Public deployment configuration, never a service-role key. No environment
// files, tokens, passwords or storage are read by this module.
export const DEFAULT_CONFIG = Object.freeze({
  ...PUBLIC_BACKEND,
  enabled: true,
  writesEnabled: false,
  agendaSyncApproved: false,
  timeoutMs: 20000,
});

export function validateConfig(input = {}, origin = globalThis.location?.origin) {
  const config = { ...DEFAULT_CONFIG, ...input };
  if (config.supabaseUrl !== PUBLIC_BACKEND.supabaseUrl) {
    throw new IntegrationError('untrusted_backend', 'O destino não corresponde ao backend oficial configurado.');
  }
  const key = config.publishableKey;
  if (typeof key !== 'string' || key !== PUBLIC_BACKEND.publishableKey) {
    throw new IntegrationError('invalid_public_key', 'Use somente a configuração pública original da clínica.');
  }
  config.timeoutMs = Math.max(1000, Math.min(60000, Number(config.timeoutMs) || 20000));
  config.origin = origin || '';
  return Object.freeze(config);
}

export function assertNetworkAllowed(config, { write = false, agendaSync = false } = {}) {
  if (!config.enabled) {
    throw new IntegrationError('integration_disabled', 'A conexão real está desativada na configuração deste ambiente.');
  }
  if (!ALLOWED_ORIGINS.includes(config.origin)) {
    throw new IntegrationError('origin_not_allowed', 'Esta origem não é autorizada pelas APIs existentes. Use a homologação em localhost:8765 ou o domínio oficial.');
  }
  if (write && !config.writesEnabled) {
    throw new IntegrationError('writes_disabled', 'Gravação real desativada nesta homologação. Os dados não foram enviados.');
  }
  if (agendaSync && !config.agendaSyncApproved) {
    throw new IntegrationError('agenda_sync_not_approved', 'A consulta da agenda também sincroniza lembretes no servidor. Esta operação precisa estar habilitada na homologação.');
  }
}
