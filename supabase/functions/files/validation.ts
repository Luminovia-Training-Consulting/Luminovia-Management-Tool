import {fileTypeFromBuffer} from 'npm:file-type@22.3.0';
export const MAX_FILE_SIZE=100*1024*1024;
const supported:Record<string,string[]>={
 'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg'],'image/webp':['webp'],'text/plain':['txt'],
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['xlsx'],
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':['pptx'],
};
export function safeName(name:string){return name.normalize('NFC').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,200);}
export async function validateFile(bytes:Uint8Array,name:string,declared:string):Promise<string>{
 if(bytes.length<1||bytes.length>MAX_FILE_SIZE)throw new Error('file_size');
 const extension=name.split('.').pop()?.toLowerCase()??'';
 let actual:string|undefined;try{actual=(await fileTypeFromBuffer(bytes))?.mime;}catch{/* Very short text buffers have no binary signature. */}
 if(!actual&&extension==='txt'){
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  if(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text))throw new Error('unsupported_type');
  actual='text/plain';
 }
 if(!actual||!supported[actual]?.includes(extension)||(declared&&declared!==actual))throw new Error('unsupported_type');
 if(['docx','xlsx','pptx'].includes(extension)&&new TextDecoder('iso-8859-1').decode(bytes).toLowerCase().includes('vbaproject.bin'))throw new Error('unsupported_type');
 return actual;
}
export function downloadDisposition(name:string){return `attachment; filename*=UTF-8''${encodeURIComponent(safeName(name)).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;}
