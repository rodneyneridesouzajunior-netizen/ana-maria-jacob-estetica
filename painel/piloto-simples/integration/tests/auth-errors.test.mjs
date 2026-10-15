import test from 'node:test';
import assert from 'node:assert/strict';
import {errorMessage,IntegrationError} from '../errors.mjs';
const wrapped=cause=>Object.assign(new Error('arbitrary private response'),{code:'invalid_credentials',cause});
test('login exposes recognized password, confirmation, throttling and network causes without leaking messages',()=>{
 assert.match(errorMessage(wrapped({code:'invalid_credentials',status:400})),/E-mail ou senha não conferem/);
 assert.match(errorMessage(wrapped({code:'email_not_confirmed',status:400})),/ainda não foi confirmado/);
 assert.match(errorMessage(wrapped({code:'over_request_rate_limit',status:429})),/Muitas tentativas/);
 assert.match(errorMessage(wrapped({name:'AuthRetryableFetchError',status:0})),/serviço de acesso não respondeu/);
 assert.match(errorMessage(wrapped({code:'unexpected_failure',status:503})),/serviço de acesso não respondeu/);
});
test('unknown SDK failure is not misreported as wrong password and raw messages stay hidden',()=>{
 for(const error of [wrapped({code:'unknown',status:400,message:'password=secret token=private'}),new Error('password=secret token=private')]){
  assert.doesNotMatch(errorMessage(error),/secret|private|senha não conferem/);
 }
 assert.match(errorMessage({code:'invalid_totp_code'}),/autenticador/);
 assert.equal(errorMessage(new IntegrationError('denied','Mensagem segura.')),'Mensagem segura.');
});
