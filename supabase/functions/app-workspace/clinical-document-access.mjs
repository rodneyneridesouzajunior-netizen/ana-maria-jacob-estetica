// Historical records predate the signed-receipt pipeline. Reading their exact
// stored PDF must not promote them to a received/signed clinical document.
export function historicalPDFPath(source){
 if(source?.source_kind!=='anamnese'||source.type!=='anamnese'||source.status!=='legado'||source.bucket!=='fichas-pdf')return null;
 const path=source.pdf_path;
 // The legacy migration recorded a single object name at the bucket root.
 // Never accept a client path, traversal, encoded separators or another folder.
 if(typeof path!=='string'||path.length>500||path!==path.trim()||!path.toLowerCase().endsWith('.pdf')||path.length<5||path.includes('..')||/[\\/\x00-\x1f\x7f%?#:]/.test(path))return null;
 return path;
}
