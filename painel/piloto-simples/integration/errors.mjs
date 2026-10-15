export class IntegrationError extends Error {
  constructor(code, message, { status = 0, uncertain = false } = {}) {
    super(message);
    this.name = 'IntegrationError';
    this.code = code;
    this.status = status;
    this.uncertain = uncertain;
  }
}

const AUTH_MESSAGES=Object.freeze({
  missing_credentials:'Informe o e-mail e a senha da conta já existente na clínica.',
  invalid_credentials:'E-mail ou senha não conferem. Use o acesso já existente na clínica.',
  email_not_confirmed:'O e-mail desta conta ainda não foi confirmado. Confira o acesso na área oficial.',
  over_request_rate_limit:'Muitas tentativas de acesso. Aguarde alguns minutos antes de tentar novamente.',
  over_email_send_rate_limit:'O serviço limitou temporariamente as tentativas. Aguarde alguns minutos.',
  invalid_totp:'Digite os 6 números do aplicativo autenticador.',
  invalid_totp_code:'O código do autenticador não confere ou já expirou. Use o código atual.',
  mfa_verification_failed:'O código do autenticador não confere ou já expirou. Use o código atual.',
  mfa_challenge_expired:'A confirmação expirou. Digite um novo código do autenticador.',
  signin_pending:'Aguarde a verificação de acesso anterior terminar.',
  signout_pending:'Aguarde o encerramento da sessão anterior.',
  session_cancelled:'Este acesso foi cancelado. Entre novamente para continuar.',
  session_storage_unavailable:'O navegador bloqueou o armazenamento desta aba. Permita o armazenamento para entrar.',
  invalid_configuration:'A configuração pública de autenticação está incompleta.',
  session_error:'Não foi possível validar a sessão. Entre novamente na clínica.',
  aal_error:'Não foi possível conferir a proteção em duas etapas. Tente novamente.',
  factor_list_failed:'Não foi possível consultar o autenticador. Tente novamente.',
  factor_missing:'Nenhum autenticador ativo foi encontrado. Confira a conta na área oficial.',
  challenge_failed:'Não foi possível iniciar a confirmação do autenticador. Tente novamente.',
  aal_refresh_failed:'O código foi aceito, mas a sessão não foi atualizada. Entre novamente.',
  aal2_required:'Confirme o autenticador para acessar os dados da clínica.',
});
// The original auth controller wraps SDK failures with a generic outer code.
// Inspect only known cause codes/statuses; never display arbitrary messages,
// request URLs, tokens, passwords or server response bodies.
export function errorMessage(error){
  if(error instanceof IntegrationError)return error.message;
  const cause=error?.cause??error;
  if(cause?.status===429)return AUTH_MESSAGES.over_request_rate_limit;
  if(cause?.name==='AuthRetryableFetchError'||cause?.code==='request_timeout'||cause?.status>=500)
    return 'O serviço de acesso não respondeu. Confira a conexão e tente novamente; não é possível concluir que a senha está errada.';
  if(Object.hasOwn(AUTH_MESSAGES,cause?.code??''))return AUTH_MESSAGES[cause.code];
  // An unknown nested failure is not evidence of an incorrect password.
  if(error?.code==='invalid_credentials'&&error.cause)
    return 'O serviço recusou a entrada, mas não informou uma causa reconhecida. Confira o acesso na área oficial e tente novamente.';
  if(Object.hasOwn(AUTH_MESSAGES,error?.code??''))return AUTH_MESSAGES[error.code];
  return 'Não foi possível concluir esta operação. Tente novamente após conferir a conexão.';
}
