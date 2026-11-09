import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyAsaasWebhookToken, PixAdapter, StripeAdapter } from '../lib/billing/events';

const secret = 'ExemploDeTokenAsaasParaTesteSomente2026_12345';

test('webhook Asaas exige token exato do header, não HMAC do corpo', () => {
  assert.equal(verifyAsaasWebhookToken(secret, secret), true);
  assert.equal(verifyAsaasWebhookToken(secret.slice(0, -1), secret), false);
  assert.equal(verifyAsaasWebhookToken(null, secret), false);
  assert.equal(verifyAsaasWebhookToken(secret, 'curto'), false);
});
test('evento Asaas usa id único evt e identidade financeira vinculada ao banco', () => {
  const event = PixAdapter.normalize({
    id: 'evt_123', event: 'PAYMENT_RECEIVED',
    payment: { id: 'pay_123', externalReference: '123', value: 175.25 },
  });
  assert.equal(event.id, 'evt_123');
  assert.equal(event.type, 'payment.succeeded');
  assert.equal(event.tenantId, null);
  assert.equal(event.invoiceGatewayId, 'pay_123');
  assert.equal(event.amountBrl, 175.25);
});
test('evento Asaas sem id evt é inválido, não usa categoria como id', () => {
  assert.equal(PixAdapter.normalize({ event: 'PAYMENT_RECEIVED', payment: { id: 'pay_11' } }).id, '');
});
test('evento Stripe sem data.object não causa crash na normalização', () => {
  assert.equal(StripeAdapter.normalize({ id: 'evt_x', type: 'unknown' }).id, 'evt_x');
});
