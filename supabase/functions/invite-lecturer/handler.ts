/**
 * Testbarer Einladungshandler mit dauerhafter Datenbankreservierung vor jeder Zustellung. Unklare Sendeergebnisse werden nicht automatisch erneut verschickt; die serverseitige Reservierung hält Wiederholungen auseinander.
 */
/** Dependency-injected invitation boundary. All sends require a durable DB reservation first. */
// Validierter Aufruf mit normalisierter Email und explizitem Wiederholungsschlüssel.
export type InviteBody = {email:string; display_name:string; idempotency_key:string};
// Ergebnis der dauerhaften Datenbankreservierung; nur reserved erlaubt einen Versand.
type Reservation = {status:string;invitation_id?:string};
// Testbare Grenze für echte Aufruferrechte, Reservierung, Versand und dauerhaften Abschluss.
export type InviteDependencies = {
 enabled:boolean;
 allowedOrigins:readonly string[];
 appOrigin:string;
 authorize:(token:string)=>Promise<boolean>;
 reserve:(token:string,body:InviteBody)=>Promise<Reservation>;
 send:(body:InviteBody,redirectTo:string)=>Promise<string>;
 complete:(id:string,userId:string|null,name:string,success:boolean)=>Promise<void>;
};
// Verweigert unbekannte Felder und normalisiert Email, Anzeigename und den Wiederholungsschlüssel.
export function parseBody(value:unknown):InviteBody|null {
 if(!value || typeof value!=='object' || Array.isArray(value)) return null;
 const v=value as Record<string,unknown>;
 if(Object.keys(v).some(k=>!['email','display_name','idempotency_key'].includes(k))) return null;
 if(typeof v.email!=='string' || typeof v.idempotency_key!=='string')return null;
 const email=v.email.trim().toLowerCase();
 if(email.length>254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.idempotency_key))return null;
 if(v.display_name!==undefined && (typeof v.display_name!=='string' || v.display_name.length>120))return null;
 return {email,idempotency_key:v.idempotency_key,display_name:typeof v.display_name==='string'?v.display_name.trim():''};
}
// Liest höchstens den vereinbarten kleinen Einladungsbody und bricht den Stream bei Überschreitung ab.
async function readBoundedBody(request:Request):Promise<string|null> {
 const reader=request.body?.getReader();if(!reader)return '';
 const chunks:Uint8Array[]=[];let size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>2048){await reader.cancel();return null;}chunks.push(value);}
 const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
 return new TextDecoder('utf-8',{fatal:true}).decode(bytes);
}
// Prüft Origin/Auth und reserviert dauerhaft vor dem Senden; unsichere Versandfehler bleiben gegen automatische Wiederholung gesperrt.
export function createHandler(deps:InviteDependencies) {
 return async(request:Request):Promise<Response>=>{
  const origin=request.headers.get('Origin')??'';
  const allowed=deps.allowedOrigins.includes(origin);
  const headers:Record<string,string>={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin'};
  if(allowed)Object.assign(headers,{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'});
  const respond=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers});
  if(!allowed)return respond(403,{error:'origin_not_allowed'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return respond(405,{error:'method_not_allowed'});
  if(!deps.enabled)return respond(503,{error:'invitations_disabled'});
  const token=/^Bearer (\S+)$/.exec(request.headers.get('Authorization')??'')?.[1];
  if(!token)return respond(401,{error:'authentication_required'});
  try {
   if(!await deps.authorize(token))return respond(403,{error:'permission_or_mfa_required'});
   if(Number(request.headers.get('Content-Length')??0)>2048)return respond(413,{error:'request_too_large'});
   const raw=await readBoundedBody(request);if(raw===null)return respond(413,{error:'request_too_large'});
   let parsed:unknown;try{parsed=JSON.parse(raw);}catch{return respond(400,{error:'invalid_request'});}
   const body=parseBody(parsed);if(!body)return respond(400,{error:'invalid_request'});
   const reservation=await deps.reserve(token,body);
   if(reservation.status!=='reserved')return respond(reservation.status==='throttled'?429:reservation.status==='idempotency_conflict'?409:200,reservation);
   if(!reservation.invitation_id)throw new Error('Reservation unavailable');
   let userId:string;
   try{userId=await deps.send(body,new URL('/auth/callback',deps.appOrigin).toString());}
   catch{
    // Uncertain send failures are durably blocked from automatic retry.
    await deps.complete(reservation.invitation_id,null,body.display_name,false);
    return respond(502,{status:'failed',invitation_id:reservation.invitation_id});
   }
   // Failure after the email sent leaves reservation in_progress, preventing duplicate send.
   await deps.complete(reservation.invitation_id,userId,body.display_name,true);
   return respond(200,{status:'sent',invitation_id:reservation.invitation_id});
  }catch{return respond(503,{error:'invitation_unavailable'});}
 };
}
