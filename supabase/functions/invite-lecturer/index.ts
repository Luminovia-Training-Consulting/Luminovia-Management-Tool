import {createClient} from 'npm:@supabase/supabase-js@2.119.0';
import {createHandler} from './handler.ts';
const url=Deno.env.get('SUPABASE_URL')??'';
const anon=Deno.env.get('SUPABASE_ANON_KEY')??'';
const secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
const client=(token:string)=>createClient(url,anon,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
const service=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
const appOrigin=Deno.env.get('PORTAL_APP_ORIGIN')??'';
const origins=(Deno.env.get('PORTAL_ALLOWED_ORIGINS')??'').split(',').map(x=>x.trim()).filter(Boolean);
const enabled=Deno.env.get('PORTAL_INVITES_ENABLED')==='true' && origins.includes(appOrigin);
Deno.serve(createHandler({
 enabled,allowedOrigins:origins,appOrigin,
 authorize:async(token)=>{
  const user=client(token);
  const {data,error}=await user.auth.getUser(token);if(error||!data.user)return false;
  const permissions=await user.rpc('get_my_permissions');
  return !permissions.error && Array.isArray(permissions.data) && permissions.data.includes('users.manage');
 },
 reserve:async(token,body)=>{
  const {data,error}=await client(token).rpc('reserve_invitation',{p_email:body.email,p_idempotency_key:body.idempotency_key});
  if(error)throw error;return data;
 },
 send:async(body,redirectTo)=>{
  const {data,error}=await service.auth.admin.inviteUserByEmail(body.email,{redirectTo});
  if(error||!data.user)throw error??new Error('Invitation failed');return data.user.id;
 },
 complete:async(id,userId,name,success)=>{
  const {error}=await service.rpc('complete_invitation',{p_invitation_id:id,p_user_id:userId,p_display_name:name,p_success:success});
  if(error)throw error;
 },
}));
