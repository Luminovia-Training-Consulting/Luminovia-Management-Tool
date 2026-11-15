import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {scan} from './clamav.ts';
import {downloadDisposition,MAX_FILE_SIZE,safeName,validateFile} from './validation.ts';
const url=Deno.env.get('SUPABASE_URL')??'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')??'';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const service=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const origins=(Deno.env.get('PORTAL_ALLOWED_ORIGINS')??'').split(',').map(v=>v.trim()).filter(Boolean);
const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
interface Document {id:string;owner_id:string;scope:string;kind:string;room_id:string|null;job_id:string|null;original_name:string;mime_type:string;size_bytes:number;status:string;current_version_id:string;deleted_at:string|null}
async function bounded(request:Request,limit:number):Promise<Uint8Array>{
 if(Number(request.headers.get('content-length')??0)>limit)throw new Error('file_size');
 const reader=request.body?.getReader();if(!reader)return new Uint8Array();let size=0;const chunks:Uint8Array[]=[];
 while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>limit){await reader.cancel();throw new Error('file_size');}chunks.push(value);}
 const all=new Uint8Array(size);let at=0;for(const part of chunks){all.set(part,at);at+=part.length;}return all;
}
Deno.serve(async(request:Request)=>{
 const origin=request.headers.get('origin')??'';
 const headers:Record<string,string>={'Cache-Control':'no-store, private','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Vary':'Origin'};
 if(origins.includes(origin)){headers['Access-Control-Allow-Origin']=origin;headers['Access-Control-Allow-Headers']='authorization,apikey,content-type,x-client-info';headers['Access-Control-Allow-Methods']='POST, OPTIONS';headers['Access-Control-Expose-Headers']='Content-Disposition';}
 const json=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{...headers,'Content-Type':'application/json'}});
 if(!origins.includes(origin))return json(403,{error:'origin_not_allowed'});
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(request.method!=='POST')return json(405,{error:'method_not_allowed'});
 const token=/^Bearer (\S+)$/.exec(request.headers.get('authorization')??'')?.[1];
 if(!token)return json(401,{error:'authentication_required'});
 const user=createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const auth=await user.auth.getUser(token);if(auth.error||!auth.data.user)return json(401,{error:'authentication_required'});
  const actor=auth.data.user.id;
  const profile=await user.from('profiles').select('id,active').eq('id',actor).maybeSingle();
  if(profile.error||!profile.data?.active)return json(403,{error:'access_denied'});
  const visible=async(id:string)=>{const r=await user.from('documents').select('*').eq('id',id).maybeSingle();if(r.error||!r.data)throw new Error('access_denied');return r.data as Document;};
  if(request.headers.get('content-type')?.startsWith('multipart/form-data')){
   const raw=await bounded(request,MAX_FILE_SIZE+16384);
   const form=await new Response(new Uint8Array(raw),{headers:{'Content-Type':request.headers.get('content-type')!}}).formData();
   const file=form.get('file');if(!(file instanceof File))return json(400,{error:'invalid_request'});
   const name=safeName(file.name);if(!name)return json(400,{error:'invalid_request'});
   const bytes=new Uint8Array(await file.arrayBuffer());
   const mime=await validateFile(bytes,name,file.type);
   const incomingDigest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   const clientId=form.get('client_id');if(!uuid(clientId))return json(400,{error:'invalid_request'});
   const scope=String(form.get('scope')??'personal');
   const roomId=form.get('room_id')||null;const jobId=form.get('job_id')||null;const replaceId=form.get('replace_id')||null;const ownerId=form.get('owner_id')||null;
   if((roomId&&!uuid(roomId))||(jobId&&!uuid(jobId))||(replaceId&&!uuid(replaceId))||(ownerId&&!uuid(ownerId)))return json(400,{error:'invalid_request'});
   const reserved=await user.rpc('reserve_document',{p_name:name,p_mime:mime,p_size:bytes.length,p_scope:scope,p_kind:String(form.get('kind')??(scope==='room'?'chat':'material')),p_room_id:roomId,p_job_id:jobId,p_client_id:clientId,p_replace_id:replaceId,p_owner_id:ownerId});
   if(reserved.error)return json(403,{error:'upload_not_allowed'});
   const reservation=reserved.data as {document_id:string;version_id:string;object_path:string;status:string};
   if(!uuid(reservation.document_id)||!uuid(reservation.version_id))return json(503,{error:'upload_failed'});
   const doc=await visible(reservation.document_id);
   if(doc.current_version_id!==reservation.version_id)return json(409,{error:'version_superseded'});
   const requestedVersion=await user.from('document_versions').select('sha256').eq('id',reservation.version_id).eq('document_id',doc.id).maybeSingle();
   if(requestedVersion.error||!requestedVersion.data)return json(503,{error:'upload_failed'});
   if(requestedVersion.data.sha256&&requestedVersion.data.sha256!==incomingDigest)return json(409,{error:'idempotency_conflict'});
   if(doc.status==='clean'){if(!requestedVersion.data.sha256)return json(503,{error:'upload_failed'});return json(200,{document:doc});}
   if(doc.status==='rejected')return json(422,{error:'scan_rejected',document_id:doc.id});
   const upload=await service.storage.from('portal-quarantine').upload(reservation.object_path,bytes,{contentType:mime,upsert:false,cacheControl:'0'});
   if(upload.error&&upload.error.message!=='The resource already exists'&&String((upload.error as {statusCode?:string}).statusCode)!=='409')return json(503,{error:'upload_failed'});
   // Always scan the immutable stored object, including after an uncertain retry.
   const stored=await service.storage.from('portal-quarantine').download(reservation.object_path);
   if(stored.error||!stored.data)return json(503,{error:'upload_failed'});
   const storedBytes=new Uint8Array(await stored.data.arrayBuffer());
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',storedBytes))).map(b=>b.toString(16).padStart(2,'0')).join('');
   if(digest!==incomingDigest)return json(409,{error:'idempotency_conflict'});
   await validateFile(storedBytes,name,mime);
   await service.from('document_versions').update({status:'scanning'}).eq('id',reservation.version_id);
   await service.from('documents').update({status:'scanning'}).eq('id',doc.id).eq('current_version_id',reservation.version_id);
   let verdict:{clean:boolean;version:string};
   try{verdict=await scan(storedBytes,Deno.env.get('PORTAL_CLAMAV_HOST')??'',Number(Deno.env.get('PORTAL_CLAMAV_PORT')??3310));}
   catch{
    await service.from('document_versions').update({status:'scan_error'}).eq('id',reservation.version_id);
    await service.from('documents').update({status:'scan_error'}).eq('id',doc.id).eq('current_version_id',reservation.version_id);
    return json(503,{error:'scanner_unavailable',document_id:doc.id});
   }
   if(!verdict.clean){
    await service.from('document_versions').update({status:'rejected',sha256:digest,scanner_version:verdict.version}).eq('id',reservation.version_id);
    await service.from('documents').update({status:'rejected'}).eq('id',doc.id).eq('current_version_id',reservation.version_id);
    await service.from('audit_events').insert({actor_id:actor,action:'document.scan_rejected',resource_id:doc.id});
    return json(422,{error:'scan_rejected',document_id:doc.id});
   }
   await visible(doc.id); // Membership can change while an upload is being scanned.
   const clean=await service.storage.from('portal-clean').upload(reservation.object_path,storedBytes,{contentType:mime,upsert:false,cacheControl:'0'});
   if(clean.error&&String((clean.error as {statusCode?:string}).statusCode)!=='409')return json(503,{error:'upload_failed'});
   const version=await service.from('document_versions').update({status:'clean',sha256:digest,scanner_version:verdict.version}).eq('id',reservation.version_id);
   const update=await service.from('documents').update({status:'clean'}).eq('id',doc.id).eq('current_version_id',reservation.version_id).select('id').maybeSingle();
   if(!update.data)return json(409,{error:'version_superseded'});
   if(version.error||update.error)return json(503,{error:'upload_failed'});
   await service.from('audit_events').insert({actor_id:actor,action:'document.scan_clean',resource_id:doc.id});
   await service.storage.from('portal-quarantine').remove([reservation.object_path]);
   return json(200,{document:await visible(doc.id)});
  }
  const data=JSON.parse(new TextDecoder().decode(await bounded(request,4096))) as {action?:string;id?:string;version_id?:string};
  if(data.action!=='download'||!uuid(data.id)||(data.version_id&&!uuid(data.version_id)))return json(400,{error:'invalid_request'});
  const doc=await visible(data.id);
  const version=await user.from('document_versions').select('id,object_path,status,original_name,mime_type').eq('id',data.version_id??doc.current_version_id).eq('document_id',doc.id).maybeSingle();
  if(version.error||!version.data||version.data.status!=='clean')return json(409,{error:'file_not_clean'});
  const file=await service.storage.from('portal-clean').download(version.data.object_path);
  if(file.error||!file.data)return json(404,{error:'file_not_found'});
  await visible(doc.id); // Recheck revocation immediately before returning any bytes.
  await service.from('audit_events').insert({actor_id:actor,action:'document.downloaded',resource_id:doc.id});
  return new Response(file.data,{headers:{...headers,'Content-Type':version.data.mime_type,'Content-Disposition':downloadDisposition(version.data.original_name),'Content-Security-Policy':"default-src 'none'; sandbox"}});
 }catch(error){
  const code=error instanceof Error?error.message:'';
  return json(code==='access_denied'?403:code==='file_size'?413:code==='unsupported_type'?415:400,{error:['access_denied','file_size','unsupported_type'].includes(code)?code:'invalid_request'});
 }
});
