/**
 * Datei-Allowlist anhand tatsächlicher Bytes, Endung und deklarierter MIME-Angabe. Normalisierte Namen und sicher codierte Downloadheader ergänzen diese Prüfung; ein akzeptiertes Format ist noch kein Malware-Freigabebefund.
 */
import {fileTypeFromBuffer} from 'npm:file-type@22.3.0';
export const MAX_FILE_SIZE=100*1024*1024;
const supported:Record<string,string[]>={
 'application/pdf':['pdf'],'image/png':['png'],'image/jpeg':['jpg','jpeg'],'image/webp':['webp'],'text/plain':['txt'],
 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':['docx'],
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['xlsx'],
 'application/vnd.openxmlformats-officedocument.presentationml.presentation':['pptx'],
};
const macroProjectName = new TextEncoder().encode('vbaproject.bin');

/** Preserve the case-insensitive VBA marker deny rule without turning an entire
 * allowed 100 MiB ZIP into two large Unicode strings. ASCII filenames can be
 * compared directly in the existing byte buffer with constant extra memory. */
// Sucht den VBA-Projektmarker direkt im Bytepuffer, ohne den ganzen erlaubten Office-ZIP in große Unicodekopien umzuwandeln.
function containsMacroProject(bytes:Uint8Array):boolean {
 for(let at=0;at<=bytes.length-macroProjectName.length;at++){
  if(bytes[at]!==0x76&&bytes[at]!==0x56)continue;
  let matched=true;
  for(let part=1;part<macroProjectName.length;part++){
   const actual=bytes[at+part];
   const folded=actual>=0x41&&actual<=0x5a?actual+0x20:actual;
   if(folded!==macroProjectName[part]){matched=false;break;}
  }
  if(matched)return true;
 }
 return false;
}
// Entfernt Pfadanteile und Steuerzeichen und begrenzt den normalisierten Anzeigenamen.
export function safeName(name:string){return name.normalize('NFC').split(/[\\/]/).pop()!.replace(/[\u0000-\u001f\u007f]/g,'').trim().slice(0,200);}
// Vergleicht Magic Bytes, Endung und deklarierte MIME-Angabe und verweigert bekannte VBA-Projektmarker.
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
 if(['docx','xlsx','pptx'].includes(extension)&&containsMacroProject(bytes))throw new Error('unsupported_type');
 return actual;
}
// Codiert den bereinigten Namen als RFC-5987-Downloadparameter ohne ungequotete Headerwerte.
export function downloadDisposition(name:string){return `attachment; filename*=UTF-8''${encodeURIComponent(safeName(name)).replace(/['()*]/g,char=>`%${char.charCodeAt(0).toString(16).toUpperCase()}`)}`;}
