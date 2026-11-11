/**
 * Resend usa assinaturas compatíveis com Svix: HMAC-SHA256 da string
 * "svix-id.svix-timestamp.rawBody" com segredo whsec_ em base64.
 * Verificar o corpo CRU antes de JSON.parse(). Nenhuma dependência de rede.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export const RESEND_WEBHOOK_TOLERANCE_SECONDS = 300;

function header(headers: Headers, suffix: 'id'|'timestamp'|'signature'):string {
  return headers.get('svix-'+suffix) ?? headers.get('webhook-'+suffix) ?? '';
}
function decodeSecret(secret:string):Buffer|null {
  if(!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret))return null;
  const payload=secret.slice(6);
  const raw=Buffer.from(payload,'base64');
  if(raw.length<16 || raw.toString('base64').replace(/=+$/,'') !== payload.replace(/=+$/,''))return null;
  return raw;
}
function decodeSignature(s:string):Buffer|null {
  if(!/^[A-Za-z0-9+/]{43}=$/.test(s))return null;
  const bytes=Buffer.from(s,'base64');
  return bytes.length===32&&bytes.toString('base64')===s?bytes:null;
}
export type VerifiedResendMessage = {id:string;timestamp:number;payload:string};
export function verifyResendWebhook(
  rawBody:string,headers:Headers,secret:string,nowSeconds=Math.floor(Date.now()/1000),
):VerifiedResendMessage|null {
  const id=header(headers,'id');
  const timestamp=header(headers,'timestamp');
  const signatures=header(headers,'signature');
  const key=decodeSecret(secret);
  if(!key || !/^[A-Za-z0-9_-]{8,128}$/.test(id) ||
     !/^\d{10}$/.test(timestamp) || signatures.length>2048 ||
     !Number.isSafeInteger(nowSeconds))return null;
  const when=Number(timestamp);
  if(!Number.isSafeInteger(when)||Math.abs(nowSeconds-when)>RESEND_WEBHOOK_TOLERANCE_SECONDS)
    return null;
  const digest=createHmac('sha256',key).update(id+'.'+timestamp+'.'+rawBody,'utf8').digest();
  const entries=signatures.trim().split(/\s+/);
  if(entries.length>16)return null;
  let valid=false;
  for(const entry of entries){
    if(!entry.startsWith('v1,'))continue;
    const received=decodeSignature(entry.slice(3));
    if(received && timingSafeEqual(received,digest))valid=true;
  }
  return valid?{id,timestamp:when,payload:rawBody}:null;
}
