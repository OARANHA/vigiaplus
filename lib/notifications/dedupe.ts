/**
 * Chaves de entrega ALT-01. O destino não aparece em claro no identificador:
 * uma chave distingue tenant (índice no banco), regra, fato, dia, canal e
 * destinatário. Não altera a chave de fatos já persistidos pelo legado.
 */
import { createHash } from 'node:crypto';

export function canonicalDestination(channel: string, destination: string): string {
  const trimmed = destination.trim();
  // Domínios/caixas de e-mail são tratados sem distinção de caixa na nossa
  // plataforma. Outras integrações podem usar identificadores case-sensitive.
  return channel.trim().toLowerCase() === 'email' ? trimmed.toLowerCase() : trimmed;
}

export function sameDestination(
  firstChannel: string, firstDestination: string,
  secondChannel: string, secondDestination: string,
): boolean {
  return firstChannel.trim().toLowerCase() === secondChannel.trim().toLowerCase()
    && canonicalDestination(firstChannel, firstDestination)
      === canonicalDestination(secondChannel, secondDestination);
}

export function deliveryDedupeKey(input: {
  ruleId: number;
  factKind: string;
  factId: string | number;
  dayUtc: string;
  channel: string;
  destination: string;
}): string {
  const canonical = JSON.stringify([
    input.ruleId, input.factKind, String(input.factId), input.dayUtc,
    input.channel.trim().toLowerCase(),
    canonicalDestination(input.channel, input.destination),
  ]);
  return 'v2:' + createHash('sha256').update(canonical, 'utf8').digest('hex');
}

/** Somente para reconhecer o histórico anterior à migração; nunca gerar nova entrega com esta chave. */
export function legacyDeliveryDedupeKey(input: {
  ruleId: number; factKind: string; factId: string | number; dayUtc: string;
}): string {
  return `rule:${input.ruleId}:fact:${input.factKind}:${input.factId}:dia:${input.dayUtc}`;
}
