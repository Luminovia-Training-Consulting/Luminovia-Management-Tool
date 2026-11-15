import {createHandler,parseBody,type InviteDependencies} from './handler.ts';
function equal(a:unknown,b:unknown){if(JSON.stringify(a)!==JSON.stringify(b))throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);}
const key='11111111-1111-4111-8111-111111111111', body={email:'lecturer@example.test',idempotency_key:key};
function setup(overrides:Partial<InviteDependencies>={}){
 const calls:string[]=[];
 const deps:InviteDependencies={enabled:true,allowedOrigins:['http://localhost:5173'],appOrigin:'http://localhost:5173',authorize:async()=>true,reserve:async()=>{calls.push('reserve');return {status:'reserved',invitation_id:key};},send:async(_b,redirect)=>{calls.push('send');equal(redirect,'http://localhost:5173/auth/callback');return key;},complete:async()=>{calls.push('complete');},...overrides};
 return {handler:createHandler(deps),calls};
}
const request=(data:unknown=body,origin='http://localhost:5173',auth='Bearer test')=>new Request('http://localhost/invite',{method:'POST',headers:{Origin:origin,Authorization:auth,'Content-Type':'application/json'},body:JSON.stringify(data)});
Deno.test('only accepted body fields and normalized email',()=>{
 equal(parseBody({...body,email:' LECTURER@Example.test ',display_name:' Ada '}),{email:'lecturer@example.test',idempotency_key:key,display_name:'Ada'});
 equal(parseBody({...body,role:'admin'}),null);equal(parseBody({...body,idempotency_key:'wrong'}),null);equal(parseBody({...body,email:'bad'}),null);
});
Deno.test('reject foreign origin, missing auth, disabled and wrong permissions before reserving',async()=>{
 const {handler,calls}=setup();equal((await handler(request(body,'https://evil.test'))).status,403);equal((await handler(request(body,undefined,''))).status,401);equal(calls,[]);
 equal((await setup({enabled:false}).handler(request())).status,503);equal((await setup({authorize:async()=>false}).handler(request())).status,403);
});
Deno.test('durable reservation precedes send and completion',async()=>{
 const {handler,calls}=setup();const r=await handler(request());equal(r.status,200);equal(await r.json(),{status:'sent',invitation_id:key});equal(calls,['reserve','send','complete']);
});
Deno.test('idempotent retries/uncertain requests and throttled reservations never send',async()=>{
 for(const status of ['already_sent','in_progress','failed','throttled','idempotency_conflict']){
  const {handler,calls}=setup({reserve:async()=>({status,invitation_id:key})});const r=await handler(request());equal(r.status,status==='throttled'?429:status==='idempotency_conflict'?409:200);equal(calls,[]);
 }
});
Deno.test('send failures are recorded and do not return false success',async()=>{
 const calls:string[]=[];const {handler}=setup({send:async()=>{throw new Error('timeout');},complete:async(_id,user,_name,success)=>{equal(user,null);equal(success,false);calls.push('failed');}});
 const r=await handler(request());equal(r.status,502);equal((await r.json()).status,'failed');equal(calls,['failed']);
});
Deno.test('failure after sending returns unavailable, leaves durable reservation for investigation',async()=>{
 const {handler}=setup({complete:async()=>{throw new Error('DB offline');}});equal((await handler(request())).status,503);
});
Deno.test('invalid/oversized body never sends; CORS preflight only for allowlist',async()=>{
 const {handler,calls}=setup();equal((await handler(request({...body,role:'admin'}))).status,400);equal((await handler(request({...body,display_name:'x'.repeat(3000)}))).status,413);equal(calls,[]);
 const r=await handler(new Request('http://localhost/invite',{method:'OPTIONS',headers:{Origin:'http://localhost:5173'}}));equal(r.status,204);equal(r.headers.get('Access-Control-Allow-Origin'),'http://localhost:5173');
});
