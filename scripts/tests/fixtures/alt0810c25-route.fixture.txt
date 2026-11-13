/**
 * ALT-08.10C.25 — real Next.js App Router handler, ONLY available inside
 * the GitHub Actions disposable PG16 integration runner. Not an operational
 * route, not an API contract, never enabled in staging or production.
 *
 * The Next.js proxy verifies cookie signature; this handler independently
 * verifies the signed cookie plus DB session version, membership and
 * entitlement within one real PostgreSQL transaction and FORCE RLS SELECT.
 */
import {NextRequest,NextResponse} from 'next/server';
import {SESSION_COOKIE} from '@/lib/session';
import {
 assertAlt0810c24Env,newDisposableClient,readAuthorizedFixture
} from '@/lib/db/alt0810c24-disposable-pg-adapter';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};

export async function GET(req:NextRequest){
 try{
  if(process.env.ALT0810C25_EPHEMERAL!=='1')return NextResponse.json(
   {error:'not_found'},{status:404,headers});
  assertAlt0810c24Env(process.env);
 }catch{
  return NextResponse.json({error:'not_found'},{status:404,headers});
 }
 const raw=req.nextUrl.searchParams.get('tenant');
 if(!raw||!(/^[1-9][0-9]*$/).test(raw)||
    !Number.isSafeInteger(Number(raw)))
  return NextResponse.json({error:'invalid_tenant'},{status:400,headers});
 const db=newDisposableClient(process.env);
 try{
  await db.connect();
  const result=await readAuthorizedFixture(
   db,req.cookies.get(SESSION_COOKIE)?.value,Number(raw));
  if(result.status!==200)return NextResponse.json(
   {error:result.status===401?'unauthorized':'forbidden'},
   {status:result.status,headers});
  return NextResponse.json({ids:result.ids},{status:200,headers});
 }catch{
  return NextResponse.json({error:'unavailable'},{status:503,headers});
 }finally{
  await db.end().catch(()=>{});
 }
}
