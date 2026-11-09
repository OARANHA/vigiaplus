# Coleta agendada (pré-homologação)

Objetivo: **no máximo um projeto por janela global de 15 minutos = quatro inícios/hora**.
A ordenação é por tenant menos recentemente atendido, depois por projeto. Uma chave única
\`collection_schedule_slots.slot_at\` impede dupla reserva na mesma janela mesmo com
réplicas e reenvio do cron. Falhas e interrupções permanecem visíveis no ledger.

**Ativação é NO-GO em produção até homologação de isolation RLS, fontes, cron e quotas.**
A configuração do runtime nasce com \`VIGIA_COLLECTION_SCHEDULER=0\` e nenhum projeto
tem opt-in por padrão. O dono habilita individualmente cada projeto via
\`POST /api/console/collection-schedules\` com \`{"projectId":123,"enabled":true}\` em sessão owner.

\`GET /api/cron/vigia-quarter-hour\` exige \`Authorization: Bearer <CRON_SECRET>\`
e a flag \`VIGIA_COLLECTION_SCHEDULER=1\`. A rota não contém parâmetros de tenant,
não aceita cookies de usuário como privilégio e não executa fontes além das
habilitadas no projeto. O flag deve ficar desligado durante os testes isolados.

## Infraestrutura

- Em Docker/VPS, usar scheduler externo confiável (cron do SO ou serviço de agendamento)
  para chamar o endpoint a cada 15 minutos, sem expor CRON_SECRET em logs.
- Em Vercel, o plano Hobby pode restringir jobs a execução diária: validar o plano antes
  de incluir \`*/15 * * * *\` no vercel.json; configuração **não foi alterada**.
- Limitar egress de rede e validar limites GDELT/RSS. O coletor ainda carece de
  homologação operacional, especialmente sob concorrência e indisponibilidade de rede.
- Sem reexecução dentro da mesma janela: reiniciar pods não duplica cobrança de APIs.
  Slots interrompidos \`running\` precisam de alarme/recuperação explícita.
- Critério de prontidão: quatro clientes configurados, banco descartável, 4 janelas
  consecutivas com quatro tenantIds distintos; quinta janela volta ao menos recente,
  duas chamadas simultâneas ocupam somente uma janela, clientes desabilitados são excluídos.

Nenhuma migration foi aplicada a bancos reais e nenhum cron foi ativado.
