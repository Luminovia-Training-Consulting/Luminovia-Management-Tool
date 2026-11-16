/**
 * Datei-Formatfälle mit tatsächlichen Testbytes. Prüfen MIME-/Endungs-/Größenvertrag und Namen; der native Gateway-/Storage-/Scanfluss wird in den API-Suiten geprüft.
 */
import {downloadDisposition,safeName,validateFile} from './validation.ts';
import {scan} from './clamav.ts';
// Lässt eine konkrete Fixturebedingung als echten Testfehler scheitern; es gibt keinen stillen Erfolgsersatz.
function assert(value:unknown,message='assertion failed'):asserts value{if(!value)throw new Error(message)}
Deno.test('normalizes names without paths, controls or unsafe download headers',()=>{assert(safeName('../folder\\lesson\r\n.txt')==='lesson.txt');const header=downloadDisposition('lesson\r\n".pdf');assert(!/[\r\n]/.test(header));assert(header.startsWith("attachment; filename*=UTF-8''"))});
Deno.test('valid text works but forged extension, HTML and MIME disagreement are rejected',async()=>{assert(await validateFile(new TextEncoder().encode('Fictional lesson'),'lesson.txt','text/plain')==='text/plain');for(const [name,mime]of [['lesson.pdf','application/pdf'],['lesson.html','text/html'],['lesson.txt','application/pdf']]){let rejected=false;try{await validateFile(new TextEncoder().encode('Fictional lesson'),name,mime)}catch{rejected=true}assert(rejected,name)}});
Deno.test('empty/oversized/invalid binary text never passes content validation',async()=>{for(const bytes of [new Uint8Array(),new Uint8Array(104857601),new Uint8Array([0,1,2,3])]){let rejected=false;try{await validateFile(bytes,'data.txt','text/plain')}catch{rejected=true}assert(rejected)}});
Deno.test('missing scanner fails closed before network or clean verdict',async()=>{let rejected=false;try{await scan(new Uint8Array([1]),'')}catch{rejected=true}assert(rejected)});
