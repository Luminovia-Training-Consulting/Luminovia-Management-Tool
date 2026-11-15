const encoder=new TextEncoder();
async function writeAll(conn:Deno.Conn,bytes:Uint8Array){let at=0;while(at<bytes.length){const n=await conn.write(bytes.subarray(at));if(n===0)throw new Error('scanner_write');at+=n;}}
async function readResult(conn:Deno.Conn){let result='';const buffer=new Uint8Array(4096);while(result.length<4096){const n=await conn.read(buffer);if(n===null)break;result+=new TextDecoder().decode(buffer.subarray(0,n));if(result.includes('\0')||result.includes('\n'))break;}return result.trim().replace(/\0/g,'');}
async function scannerVersion(host:string,port:number){const conn=await Deno.connect({hostname:host,port});const timeout=setTimeout(()=>{try{conn.close()}catch{/*closed*/}},3000);try{await writeAll(conn,encoder.encode('zVERSION\0'));const value=await readResult(conn);if(!value.startsWith('ClamAV '))throw new Error('scanner_version');const stamp=Date.parse(value.slice(value.lastIndexOf('/')+1));if(!Number.isFinite(stamp)||Date.now()-stamp>14*86400000)throw new Error('scanner_definitions_stale');return value}finally{clearTimeout(timeout);try{conn.close()}catch{/*closed*/}}}
export async function scan(bytes:Uint8Array,host:string,port=3310):Promise<{clean:boolean;version:string}>{
 if(!host)throw new Error('scanner_not_configured');
 const version=await scannerVersion(host,port);
 const conn=await Deno.connect({hostname:host,port});
 const timeout=setTimeout(()=>{try{conn.close();}catch{/*closed*/}},30_000);
 try{
  await writeAll(conn,encoder.encode('zINSTREAM\0'));
  for(let at=0;at<bytes.length;at+=65536){const chunk=bytes.subarray(at,at+65536);const prefix=new Uint8Array(4);new DataView(prefix.buffer).setUint32(0,chunk.length,false);await writeAll(conn,prefix);await writeAll(conn,chunk);}
  await writeAll(conn,new Uint8Array(4));
  const result=await readResult(conn);
  if(!result.startsWith('stream: '))throw new Error('scanner_protocol');
  if(result.includes(' FOUND'))return {clean:false,version};
  if(result!=='stream: OK')throw new Error('scanner_unavailable_or_limit');
  return {clean:true,version};
 }finally{clearTimeout(timeout);try{conn.close();}catch{/*closed*/}}
}
