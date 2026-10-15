import test from 'node:test';
import assert from 'node:assert/strict';
import {createPostalCodeClient,normalizePostalCode} from '../postal-code.mjs';
const data=(cep='32600-000',extra={})=>({cep,logradouro:'Rua de teste',bairro:'Centro',localidade:'Betim',uf:'MG',...extra});
const ok=value=>({ok:true,json:async()=>value});

test('CEP valida os 8 dígitos antes de qualquer transmissão',async()=>{
 let calls=0;const client=createPostalCodeClient({fetchImpl:async()=>{calls++;return ok(data());}});
 for(const value of ['','123','123456789','3260a000','https://evil.invalid/32600000','32600/000'])await assert.rejects(client.lookup(value),{code:'invalid'});
 assert.equal(calls,0);assert.equal(normalizePostalCode(' 32600-000 '),'32600000');
});
test('ViaCEP recebe somente CEP por GET sem credenciais/referrer; cache é isolado e expira',async()=>{
 const calls=[];let time=100;const client=createPostalCodeClient({now:()=>time,cacheTTL:10,fetchImpl:async(url,options)=>{calls.push({url,options});return ok(data());}});
 const first=await client.lookup('32600-000');first.city='Alteração local';assert.equal((await client.lookup('32600000')).city,'Betim');assert.equal(calls.length,1);
 assert.equal(calls[0].url,'https://viacep.com.br/ws/32600000/json/');assert.equal(calls[0].options.method,'GET');assert.equal(calls[0].options.credentials,'omit');assert.equal(calls[0].options.referrerPolicy,'no-referrer');assert.equal(calls[0].options.body,undefined);assert.equal(calls[0].options.headers,undefined);
 time=111;await client.lookup('32600000');assert.equal(calls.length,2);
});
test('CEP inexistente não entra em cache nem vira endereço vazio confirmado',async()=>{
 let calls=0;const client=createPostalCodeClient({fetchImpl:async()=>{calls++;return ok({erro:true});}});
 await assert.rejects(client.lookup('00000000'),{code:'not_found'});await assert.rejects(client.lookup('00000000'),{code:'not_found'});assert.equal(calls,2);
});
test('resposta malformada, outro CEP, UF inválida e falha HTTP mantêm preenchimento manual',async()=>{
 for(const value of [null,[],{},data('30100-000'),data(undefined,{uf:'XX'}),data(undefined,{localidade:''}),data(undefined,{logradouro:'x'.repeat(301)})]){
  const client=createPostalCodeClient({fetchImpl:async()=>ok(value)});await assert.rejects(client.lookup('32600000'),{code:'unavailable'});
 }
 for(const fetchImpl of [async()=>({ok:false}),async()=>{throw Error('private network details');},async()=>({ok:true,json:async()=>{throw Error('invalid json');}})])await assert.rejects(createPostalCodeClient({fetchImpl}).lookup('32600000'),{code:'unavailable'});
});
test('timeout conclui mesmo quando fetch não coopera com abort',async()=>{
 let signal;const client=createPostalCodeClient({timeoutMs:10,fetchImpl:(_,{signal:s})=>{signal=s;return new Promise(()=>{});}});
 await assert.rejects(client.lookup('32600000'),{code:'timeout'});assert.equal(signal.aborted,true);
});
test('cancelamento encerra consulta e resposta atrasada não contamina cache',async()=>{
 let release,calls=0;const controller=new AbortController(),client=createPostalCodeClient({fetchImpl:async()=>{calls++;if(calls===1)return new Promise(resolve=>release=resolve);return ok(data());}});
 const pending=client.lookup('32600000',{signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'aborted'});release(ok(data(undefined,{localidade:'Resposta antiga'})));await Promise.resolve();
 assert.equal((await client.lookup('32600000')).city,'Betim');assert.equal(calls,2);await assert.rejects(client.lookup('32600000',{signal:controller.signal}),{code:'aborted'});
});
test('CEP geral de município aceita rua e bairro vazios sem inventar endereço',async()=>{
 const client=createPostalCodeClient({fetchImpl:async()=>ok(data(undefined,{logradouro:'',bairro:''}))});assert.deepEqual(await client.lookup('32600000'),{postalCode:'32600000',address:'',neighborhood:'',city:'Betim',state:'MG'});
});
