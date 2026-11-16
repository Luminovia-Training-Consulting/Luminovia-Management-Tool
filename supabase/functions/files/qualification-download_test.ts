import { qualificationEvidenceBytes, type QualificationDownloadDependencies } from './qualification-download.ts';
function assert(value:unknown,message='assertion failed'):asserts value {if(!value)throw new Error(message);}
async function rejects(run:Promise<unknown>){try{await run;}catch(error){assert(error instanceof Error&&error.message==='access_denied');return;}throw new Error('Expected access denial');}
async function fixture(){
 const bytes=new TextEncoder().encode('Fictional certificate V1 only.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
 const selected={id:'grant',user_id:'teacher',document_id:'doc',version_id:'v1',sha256};
 const version={id:'v1',document_id:'doc',object_path:'owned/doc/v1',status:'clean',mime_type:'text/plain',original_name:'Original.txt',size_bytes:bytes.length,sha256};
 const document={owner_id:'teacher',scope:'personal',kind:'certificate',deleted_at:null as string|null};
 let downloads=0;
 const deps:QualificationDownloadDependencies={selection:()=>Promise.resolve({...selected}),version:()=>Promise.resolve({...version}),document:()=>Promise.resolve({...document}),download:()=>{downloads++;return Promise.resolve(bytes);}};
 return{deps,selected,version,document,bytes,downloads:()=>downloads};
}
Deno.test('qualification grant downloads exact immutable V1 bytes, independent of document replacement',async()=>{const f=await fixture();const result=await qualificationEvidenceBytes('grant',f.deps);assert(result.original_name==='Original.txt');assert(result.bytes===f.bytes);assert(f.downloads()===1);});
Deno.test('ungranted, forged or another owner/version never fetches storage',async()=>{for(const change of ['missing','id','owner','version','document','kind','scope','archive','rejected','hash','size']){const f=await fixture();switch(change){case 'missing':f.deps.selection=()=>Promise.resolve(null);break;case 'id':f.selected.id='other';break;case 'owner':f.document.owner_id='peer';break;case 'version':f.version.id='v2';break;case 'document':f.version.document_id='other';break;case 'kind':f.document.kind='cv';break;case 'scope':f.document.scope='room';break;case 'archive':f.document.deleted_at=new Date().toISOString();break;case 'rejected':f.version.status='rejected';break;case 'hash':f.version.sha256='wrong';break;case 'size':f.version.size_bytes=104857601;break;}await rejects(qualificationEvidenceBytes('grant',f.deps));assert(f.downloads()===0,change+' fetched private bytes');}});
Deno.test('storage content mismatch and missing bytes fail closed',async()=>{for(const bytes of [null,new Uint8Array(3),new Uint8Array(29)]){const f=await fixture();f.deps.download=()=>Promise.resolve(bytes);await rejects(qualificationEvidenceBytes('grant',f.deps));}});
Deno.test('withdrawal, suspension, roles and replacement during object fetch are rechecked before release',async()=>{for(const action of ['withdraw','version','owner','hash']){const f=await fixture();f.deps.download=()=>{if(action==='withdraw')f.deps.selection=()=>Promise.resolve(null);if(action==='version')f.selected.version_id='v2';if(action==='owner')f.selected.user_id='peer';if(action==='hash')f.selected.sha256='c'.repeat(64);return Promise.resolve(f.bytes);};await rejects(qualificationEvidenceBytes('grant',f.deps));}});
