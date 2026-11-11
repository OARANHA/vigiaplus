/** Estado de configuração de e-mail sem revelar valores secretos. */
import { AppError } from '@/lib/tenant/errors';

export function publicHttpsOrigin(): URL {
  const raw=process.env.PUBLIC_APP_URL?.trim();
  if(!raw)throw new AppError('EMAIL_ORIGIN_NOT_CONFIGURED',503,'Configure PUBLIC_APP_URL HTTPS');
  try{
    const parsed=new URL(raw);
    if(parsed.protocol!=='https:'||parsed.username||parsed.password||
      parsed.search||parsed.hash)throw new Error('URL inválida');
    return parsed;
  }catch{
    throw new AppError('EMAIL_ORIGIN_NOT_CONFIGURED',503,'Configure PUBLIC_APP_URL HTTPS');
  }
}
export function emailSetup(){
  const keyConfigured=Boolean(process.env.RESEND_API_KEY?.trim());
  const senderConfigured=Boolean(process.env.ALERT_EMAIL_FROM?.trim());
  let publicUrlHttps=false;
  try{publicHttpsOrigin();publicUrlHttps=true;}catch{}
  return {
    keyConfigured,senderConfigured,publicUrlHttps,
    readyForTest:keyConfigured&&senderConfigured&&publicUrlHttps,
    // O domínio pode estar presente em ENV e ainda não verificado pelo Resend.
    providerDomainVerified:null as null,
  };
}
