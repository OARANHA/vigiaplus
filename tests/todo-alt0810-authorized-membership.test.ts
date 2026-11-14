import test from 'node:test';
import assert from 'node:assert/strict';
import {selectAuthorizedClientMembership as choose} from '../lib/tenant/authorized-membership';
import {AppError} from '../lib/tenant/errors';

const a={tenantId:771,role:'client_admin'};
const b={tenantId:882,role:'client_viewer'};
function rejects(code:number,run:()=>unknown){
 assert.throws(run,(error:unknown)=>error instanceof AppError&&error.status===code);
}
test('ALT-08.10: cliente único sem seleção usa tenant autenticado',()=>{
 assert.deepEqual(choose([a],null),{membership:a,spoofAttempt:null});
 assert.deepEqual(choose([a],771),{membership:a,spoofAttempt:null});
});
test('ALT-08.10: spoof de tenant diferente preserva A sem conceder B',()=>{
 assert.deepEqual(choose([a],882),{membership:a,spoofAttempt:'882'});
});
test('ALT-08.10: múltiplos vínculos exigem seleção explícita existente',()=>{
 rejects(403,()=>choose([a,b],null));
 assert.deepEqual(choose([a,b],882),{membership:b,spoofAttempt:null});
 assert.deepEqual(choose([b,a],771),{membership:a,spoofAttempt:null});
 rejects(403,()=>choose([a,b],999));
 rejects(403,()=>choose([b,a],999));
});
test('ALT-08.10: fail closed se vinculo duplicado, sem vínculo ou role estranha',()=>{
 rejects(403,()=>choose([],null));
 rejects(403,()=>choose([a,{...a}],771));
 rejects(403,()=>choose([{tenantId:771,role:'owner'}],771));
 rejects(403,()=>choose([{tenantId:0,role:'client_viewer'}],null));
});
test('ALT-08.10: rejeita tenant inválido e só aceita IDs inteiros seguros',()=>{
 for(const id of [-1,0,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1]){
  rejects(400,()=>choose([a],id));
 }
});
