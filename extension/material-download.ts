// Download through the extension origin when a Canvas file redirects across origins.
const downloads = new Map<string, {owner:string; reader:ReadableStreamDefaultReader<Uint8Array>; buffer:Uint8Array; size:number; touched:number}>();
export async function materialDownload(message:any, senderUrl:string) {
  const owner=new URL(senderUrl).origin;
  for(const [id, download] of downloads) if(Date.now()-download.touched>60000){void download.reader.cancel();downloads.delete(id)}
  if(message.op==="begin") {
    const source=new URL(message.sourceUrl);
    const ids=source.pathname.match(/^\/courses\/(\d+)\/files\/(\d+)$/);
    if(source.origin!==owner || !ids) throw new Error("Only Canvas course files can be downloaded.");
    if(downloads.size>=4)throw new Error("Downloads are busy. Retry shortly.");
    const metadata=await fetch(`${owner}/api/v1/courses/${ids[1]}/files/${ids[2]}`,{credentials:"include",signal:AbortSignal.timeout(30000)});
    if(!metadata.ok)throw new Error(`Canvas file access failed (${metadata.status}).`);
    const file=await metadata.json();
    if(file.locked_for_user || file.hidden_for_user)throw new Error("Canvas has not made this file available.");
    const url=new URL(file.url,owner);
    if(!["https:","http:"].includes(url.protocol))throw new Error("Unsupported file URL.");
    const response=await fetch(url,{credentials:url.origin===owner?"include":"omit",signal:AbortSignal.timeout(120000)});
    if(!response.ok || !response.body)throw new Error(`File download failed (${response.status}).`);
    if(response.headers.get("content-type")?.includes("text/html") && !/\.html?$/i.test(file.filename))throw new Error("Canvas returned a preview instead of a file.");
    const id=crypto.randomUUID(); downloads.set(id,{owner,reader:response.body.getReader(),buffer:new Uint8Array(),size:0,touched:Date.now()});
    return {id};
  }
  const download=downloads.get(message.id);
  if(!download || download.owner!==owner)throw new Error("Download expired. Retry syncing.");
  if(message.op==="cancel"){await download.reader.cancel();downloads.delete(message.id);return {done:true}}
  if(message.op!=="next")throw new Error("Unknown download operation.");
  download.touched=Date.now();
  if(!download.buffer.length){const part=await download.reader.read();if(part.done){downloads.delete(message.id);return {done:true}}download.buffer=part.value;download.size+=part.value.length;}
  if(download.size>100*1024*1024){await download.reader.cancel();downloads.delete(message.id);throw new Error("File exceeds 100 MB.");}
  const chunk=download.buffer.slice(0,384*1024);download.buffer=download.buffer.slice(chunk.length);
  let binary="";for(let i=0;i<chunk.length;i+=32768)binary+=String.fromCharCode(...chunk.subarray(i,i+32768));
  return {done:false,base64:btoa(binary)};
}
