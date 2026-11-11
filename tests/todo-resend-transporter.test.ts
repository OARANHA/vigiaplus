import { test } from 'node:test';
import assert from 'node:assert/strict';
import { send } from '../lib/notifications/transport';
import { emailSetup,publicHttpsOrigin } from '../lib/notifications/email-config';

test('ALT-04: ausência de chave ou remetente falha fechado, nunca usa endereço padrão',async()=>{
 const key=process.env.RESEND_API_KEY,from=process.env.ALERT_EMAIL_FROM;
 const previous=globalThis.fetch;
 let calls=0;
 globalThis.fetch=(async()=>{calls++;throw new Error('não deveria chamar rede')}) as typeof fetch;
 try{
  delete process.env.RESEND_API_KEY;delete process.env.ALERT_EMAIL_FROM;
  let response=await send({channel:'email',destination:'owner@example.com',title:'Teste',message:'Teste'});
  assert.equal(response.ok,false);assert.equal(response.detail,'EMAIL_NOT_CONFIGURED');
  process.env.RESEND_API_KEY='re_test_never_send';delete process.env.ALERT_EMAIL_FROM;
  response=await send({channel:'email',destination:'owner@example.com',title:'Teste',message:'Teste'});
  assert.equal(response.ok,false);assert.equal(calls,0);
  assert.equal(emailSetup().senderConfigured,false);
 }finally{
  globalThis.fetch=previous;
  if(key===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=key;
  if(from===undefined)delete process.env.ALERT_EMAIL_FROM;else process.env.ALERT_EMAIL_FROM=from;
 }
});

test('ALT-04: mock de Resend recebe idempotency key e devolve provider ID sanitizado',async()=>{
 const oldFetch=globalThis.fetch;
 const oldKey=process.env.RESEND_API_KEY,oldFrom=process.env.ALERT_EMAIL_FROM;
 let calls=0;
 const captured: {value:{url:string;headers:Headers;payload:Record<string,unknown>}|null}={value:null};
 globalThis.fetch=(async(input, init)=>{
  calls++;
  captured.value={url:String(input),headers:new Headers(init?.headers),
    payload:JSON.parse(String(init?.body)) as Record<string,unknown>};
  return new Response(JSON.stringify({id:'123e4567-e89b-12d3-a456-426614174000'}),{
    status:200,headers:{'Content-Type':'application/json'},
  });
 }) as typeof fetch;
 try{
  process.env.RESEND_API_KEY='re_dummy_secret_not_logged';
  process.env.ALERT_EMAIL_FROM='VigiaPlus <avisos@example.test>';
  const result=await send({channel:'email',destination:'own@example.test',
    title:'Alerta medido',message:'Número, comparação e origem',
    idempotencyKey:'vpx-delivery/123'});
  assert.equal(result.ok,true);
  assert.equal(result.detail,'HTTP 200');
  assert.equal(result.providerId,'123e4567-e89b-12d3-a456-426614174000');
  assert.equal(calls,1);
  assert.equal(captured.value?.url,'https://api.resend.com/emails');
  assert.equal(captured.value?.headers.get('Idempotency-Key'),'vpx-delivery/123');
  assert.equal(captured.value?.headers.get('Authorization'),'Bearer re_dummy_secret_not_logged');
  assert.deepEqual(captured.value?.payload.to,['own@example.test']);
  assert.equal(captured.value?.payload.from,'VigiaPlus <avisos@example.test>');
  assert.ok(!JSON.stringify(result).includes('dummy_secret'));
 }finally{
  globalThis.fetch=oldFetch;
  if(oldKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=oldKey;
  if(oldFrom===undefined)delete process.env.ALERT_EMAIL_FROM;else process.env.ALERT_EMAIL_FROM=oldFrom;
 }
});

test('ALT-04: diagnóstico exige URL HTTPS de origem configurada, sem usar Host do request',()=>{
 const old=process.env.PUBLIC_APP_URL;
 try{
  process.env.PUBLIC_APP_URL='http://local.test';assert.throws(publicHttpsOrigin);
  process.env.PUBLIC_APP_URL='https://valid.example/path?x=1';assert.throws(publicHttpsOrigin);
  process.env.PUBLIC_APP_URL='https://vigiaplus.example';
  assert.equal(publicHttpsOrigin().origin,'https://vigiaplus.example');
 }finally{
  if(old===undefined)delete process.env.PUBLIC_APP_URL;
  else process.env.PUBLIC_APP_URL=old;
 }
});
