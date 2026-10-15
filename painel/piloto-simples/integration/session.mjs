import { IntegrationError } from './errors.mjs';

// The existing AMJAuth controller owns SDK auth and sessionStorage. Clinical
// payloads never enter that storage. Server-side auth remains authoritative.
export function createSessionBridge(authController, { now = Date.now, onInvalidated = () => {} } = {}) {
  if (!authController?.getNextStep || !authController?.getSession) {
    throw new IntegrationError('auth_unavailable', 'O controlador de autenticação não foi carregado.');
  }
  let revision = 0;
  let destroyed = false;
  let currentUser = null;
  let expiryTimer = null;
  const listeners = new Set();
  const invalidate = (reason = 'session_changed') => {
    revision++;
    currentUser = null;
    clearTimeout(expiryTimer);
    expiryTimer = null;
    for (const listener of listeners) listener(reason);
    onInvalidated(reason);
  };
  const subscription = authController.client?.auth?.onAuthStateChange?.((event, session) => {
    if (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY' ||
        (currentUser && session?.user?.id && session.user.id !== currentUser)) invalidate(event);
  })?.data?.subscription;

  async function requireReady() {
    if (destroyed) throw new IntegrationError('session_closed', 'A área privada foi fechada.');
    const before = revision;
    const next = await authController.getNextStep();
    if (before !== revision || destroyed) throw new IntegrationError('session_changed', 'O acesso mudou durante a consulta.');
    if (!next.session || next.step === 'login') throw new IntegrationError('login_required', 'Entre com sua conta para acessar a área privada.');
    if (next.step !== 'ready' || next.aal?.currentLevel !== 'aal2') {
      throw new IntegrationError('mfa_required', 'Confirme o código do autenticador antes de acessar dados clínicos.');
    }
    const { access_token: token, expires_at: expiresAt, user } = next.session;
    if (!token || !user?.id || !Number.isFinite(expiresAt) || expiresAt * 1000 <= now() + 5000) {
      invalidate('session_expired');
      throw new IntegrationError('session_expired', 'A sessão expirou. Entre novamente antes de continuar.');
    }
    if (currentUser && currentUser !== user.id) {
      invalidate('identity_changed');
      throw new IntegrationError('session_changed', 'A conta mudou. Abra novamente a área privada.');
    }
    currentUser = user.id;
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => invalidate('session_expired'), Math.min(2147483647, expiresAt * 1000 - now()));
    expiryTimer.unref?.();
    return Object.freeze({ token, userId: user.id, expiresAt, revision });
  }
  async function assertCurrent(snapshot) {
    if (destroyed || snapshot.revision !== revision || snapshot.expiresAt * 1000 <= now()) {
      throw new IntegrationError('session_changed', 'O acesso mudou. A resposta foi descartada.');
    }
    const session = await authController.getSession();
    if (destroyed || snapshot.revision !== revision || snapshot.expiresAt * 1000 <= now() || !session || session.user?.id !== snapshot.userId) {
      invalidate('session_changed');
      throw new IntegrationError('session_changed', 'O acesso mudou. A resposta foi descartada.');
    }
  }
  return Object.freeze({
    requireReady, assertCurrent, invalidate,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async signOut() { invalidate('SIGNED_OUT'); await authController.signOut(); },
    destroy() { destroyed = true; invalidate('destroyed'); subscription?.unsubscribe?.(); listeners.clear(); },
  });
}
