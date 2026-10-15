import { IntegrationError } from './errors.mjs';

// The existing AMJAuth controller owns SDK auth and sessionStorage. Clinical
// payloads never enter that storage. Server-side auth remains authoritative.
export function createSessionBridge(authController, { now = Date.now, onInvalidated = () => {} } = {}) {
  if (!authController?.getNextStep || !authController?.getSession) {
    throw new IntegrationError('auth_unavailable', 'O controlador de autenticação não foi carregado.');
  }
  let revision = 0;
  let destroyed = false;
  let invalidated = false;
  let currentUser = null;
  let expiryTimer = null;
  let renewalTimer = null;
  let readinessSequence = 0;
  let scheduledSequence = 0;
  const listeners = new Set();
  const invalidate = (reason = 'session_changed') => {
    if (invalidated) return;
    invalidated = true;
    revision++;
    currentUser = null;
    clearTimeout(expiryTimer);
    clearTimeout(renewalTimer);
    expiryTimer = null;
    renewalTimer = null;
    for (const listener of listeners) listener(reason);
    onInvalidated(reason);
  };
  const subscription = authController.client?.auth?.onAuthStateChange?.((event, session) => {
    if (destroyed || invalidated) return;
    if (event === 'SIGNED_OUT' || event === 'PASSWORD_RECOVERY' ||
        (currentUser && session?.user?.id && session.user.id !== currentUser)) {
      invalidate(event);
      return;
    }
    if (currentUser && ['TOKEN_REFRESHED','SIGNED_IN','USER_UPDATED','MFA_CHALLENGE_VERIFIED'].includes(event)) {
      if (!session?.user?.id) { invalidate('session_changed'); return; }
      // SDK auth callbacks can run while its internal lock is held. Recheck
      // identity, AAL2 and expiry only after that callback returns; an event
      // alone never extends access. Keep the old deadline until verified.
      clearTimeout(renewalTimer);
      const before = revision;
      renewalTimer = setTimeout(() => {
        renewalTimer = null;
        if (destroyed || invalidated || before !== revision) return;
        void requireReady().catch(error => {
          if (!destroyed && !invalidated && before === revision && error?.code !== 'session_check_superseded') invalidate(error?.code || 'session_changed');
        });
      }, 0);
      renewalTimer.unref?.();
    }
  })?.data?.subscription;

  async function requireReady() {
    if (destroyed || invalidated) throw new IntegrationError('session_closed', 'A área privada foi fechada.');
    const before = revision;
    const sequence = ++readinessSequence;
    const next = await authController.getNextStep();
    if (before !== revision || destroyed || invalidated) throw new IntegrationError('session_changed', 'O acesso mudou durante a consulta.');
    const rejectSuperseded = () => {
      if (sequence < scheduledSequence) throw new IntegrationError('session_check_superseded', 'A sessão foi atualizada durante esta verificação. Tente novamente.');
    };
    if (!next.session || next.step === 'login') { rejectSuperseded(); throw new IntegrationError('login_required', 'Entre com sua conta para acessar a área privada.'); }
    if (next.step !== 'ready' || next.aal?.currentLevel !== 'aal2') {
      rejectSuperseded();
      throw new IntegrationError('mfa_required', 'Confirme o código do autenticador antes de acessar dados clínicos.');
    }
    const { access_token: token, expires_at: expiresAt, user } = next.session;
    if (!token || !user?.id || !Number.isFinite(expiresAt) || expiresAt * 1000 <= now() + 5000) {
      // A later call may already have validated the refreshed session. Reject
      // this obsolete result without revoking that newer verified access.
      rejectSuperseded();
      invalidate('session_expired');
      throw new IntegrationError('session_expired', 'A sessão expirou. Entre novamente antes de continuar.');
    }
    if (currentUser && currentUser !== user.id) {
      rejectSuperseded();
      invalidate('identity_changed');
      throw new IntegrationError('session_changed', 'A conta mudou. Abra novamente a área privada.');
    }
    currentUser = user.id;
    // A request that started before TOKEN_REFRESHED may resolve after its
    // newer validation. It must not restore the old timer over that result.
    if (sequence >= scheduledSequence) {
      scheduledSequence = sequence;
      clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => invalidate('session_expired'), Math.min(2147483647, expiresAt * 1000 - now()));
      expiryTimer.unref?.();
    }
    return Object.freeze({ token, userId: user.id, expiresAt, revision });
  }
  async function assertCurrent(snapshot) {
    if (destroyed || invalidated || snapshot.revision !== revision || snapshot.expiresAt * 1000 <= now()) {
      throw new IntegrationError('session_changed', 'O acesso mudou. A resposta foi descartada.');
    }
    const session = await authController.getSession();
    if (destroyed || invalidated || snapshot.revision !== revision || snapshot.expiresAt * 1000 <= now() || !session || session.user?.id !== snapshot.userId) {
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
