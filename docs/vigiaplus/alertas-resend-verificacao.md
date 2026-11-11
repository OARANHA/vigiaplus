# VIGIAPLUS — ALT-04 / ALT-05: Resend e prova de destinatário

**Estado:** implementação candidata em PR DRAFT. Nenhum e-mail real é disparado pelo teste automatizado ou pela atualização local. `ALT-04` e `ALT-05` permanecem abertos até homologação E2E.

## Configuração de e-mail (somente servidor)

`RESEND_API_KEY`, `ALERT_EMAIL_FROM` e `PUBLIC_APP_URL` devem ser configuradas por ENV/cofre. Sem chave e remetente, o transporte recusa enviar e nunca usa remetente padrão fictício. A URL de confirmação exige HTTPS absoluto e não pode vir de `Host` / input do cliente. As credenciais não são armazenadas no banco nem expostas na API.

`GET /api/console/notifications/email-diagnostics` exige sessão owner e fornece somente presença das configurações, URL HTTPS e último resultado. **Não certifica** domínio verificado na Resend. `POST` exige `{"confirm":"ENVIAR_TESTE_PARA_MINHA_CONTA"}`, envia **apenas** ao endereço da conta owner autenticada (destino de body é ignorado), registra auditoria e ID da mensagem aceito pelo Resend. Não é acionado automaticamente. Não confundir `HTTP 2xx` com entrega ao destinatário.

## Prova de posse

1. `POST /api/notifications/channels` cria um destino `verified=0`, sem prova.
2. `POST /api/notifications/channels/verify/request?tenant_id=N` requer identidade autorizada + recurso `crisis_management`. Suporta inicialmente **somente e-mail**. Exige Remetente Resend e URL HTTPS configurados.
3. Gera token de 256 bits. Só o SHA-256 vai para `notification_channel_proofs` com prazo de 30 minutos; pedido repetido antes de 10 minutos retorna 429. Link é enviado apenas ao endereço cadastrado, sem ativar o canal.
4. O destinatário abre `/confirmar-destino?token=...` e clica em **Confirmar meu e-mail**. A ação executa `POST /api/notifications/channels/verify/confirm` sem cookie. Um único SQL reclama o token, grava `notification_channels.verified_at` e insere evento `NOTIFICATION_CHANNEL_VERIFIED`. Replay, expiração ou revogação não atualizam o canal.
5. `PATCH verified=true` retorna 403. `PATCH verified=false` revoga a aprovação (limpa `verified_at`). Um flag legado `verified=1` isolado **NÃO** autoriza envio.

## Defesa também no worker e na outbox

- O worker `worker:notify` considera `verified=1` apenas se `verified_at` foi gravado por prova real. O SQL que reivindica entregas (`FOR UPDATE SKIP LOCKED`) exige canal ativo, `verified=1` **e** `verified_at IS NOT NULL`. O canal interno `ledger` é isento por não ter destino externo.
- Destinos antigos sem prova ficam **bloqueados**. Não serão habilitados silenciosamente na migração. Telegram, Slack, WhatsApp e webhook também continuam sem autorização para despachar até terem método próprio de validação. Não inventar verificação.
- Envio externo Resend usa `Idempotency-Key: vpx-delivery/<ID>`, estável nas tentativas de uma entrega. A Resend atualmente mantém idempotência por **24 horas** e requer payload idêntico. Depois dessa janela, um crash entre aceite HTTP e gravação local ainda pode causar novo envio. Não alegar exactly-once definitivo.
- A resposta de aceite armazena `provider_message_id` sem segredo; os estados `delivered`, `bounced` e `complained` serão conciliados em **ALT-06** por webhook autenticado.

## Testes e limites de aceite

Testes isolados PGlite cobrem tokens em hash, permissão por tenant, cooldown, expiração, revogação, uso único, trilha de auditoria, recusa da flag legada, bloqueio do claim até prova e ID do provedor; Resend é simulado em memória para testar ausência de remetente e cabeçalho de idempotência. Nenhum disparo real.

**Homologação pendente:** credencial/dominio de envio comprovadamente verificados no Resend, teste **manual** do proprietário para a própria caixa, E2E no navegador usando link real, validação dos canais existentes, teste em PostgreSQL descartável com role restrita, webhooks de entrega e mecanismo seguro de verificação para outros meios.

Fontes oficiais: https://resend.com/changelog/idempotency-keys e https://resend.com/features/webhooks

**Governança:** PR DRAFT, sem merge, deploy, envio real ou migração em produção sem autorização expressa.
