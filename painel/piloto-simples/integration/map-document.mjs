export const MAX_PHOTO_POINTS=200;
const pointId=/^[A-Za-z0-9_-]{1,64}$/;
const prohibited=/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
function exact(value,keys){return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));}
function text(value,max,required=false){
  if(typeof value!=='string'||Array.from(value).length>max||prohibited.test(value)||(required&&!value.trim()))throw Error('Texto da marcação inválido ou acima do limite.');
  return value;
}
function coordinate(value){if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1)throw Error('As coordenadas devem estar entre zero e um.');return value;}

// V1 is retained exactly. Unknown keys are rejected, not silently discarded or
// reinterpreted. This validator never guesses a treatment, dose or anatomy.
export function validatePhotoAnnotation(value){
  if(!exact(value,['schemaVersion','points','notes'])||![1,2].includes(value.schemaVersion)||!Array.isArray(value.points)||value.points.length>MAX_PHOTO_POINTS)throw Error('Documento inválido. Use a versão 1 ou 2 e até 200 marcações.');
  const ids=new Set();
  const points=value.points.map(point=>{
    const keys=value.schemaVersion===1?['id','x','y','label','notes']:
      ['id','kind','x','y',...(point?.kind==='ponto'?[]:['x2','y2']),'region','product','quantity','unit','lot','notes'];
    if(!exact(point,keys)||typeof point.id!=='string'||!pointId.test(point.id)||ids.has(point.id))throw Error('Marcação com campos não suportados ou identificador inválido/duplicado. Nenhum campo foi descartado.');
    ids.add(point.id);
    const x=coordinate(point.x),y=coordinate(point.y);
    if(value.schemaVersion===1)return {id:point.id,x,y,label:text(point.label,100),notes:text(point.notes,2000)};
    if(!['ponto','linha','leque'].includes(point.kind))throw Error('Tipo de marcação inválido.');
    const ends=point.kind==='ponto'?{}:{x2:coordinate(point.x2),y2:coordinate(point.y2)};
    if(point.quantity!==null&&(typeof point.quantity!=='number'||!Number.isFinite(point.quantity)||point.quantity<=0||point.quantity>100000))throw Error('Quantidade informada inválida.');
    if(!['mL','U','mg','sem quantidade'].includes(point.unit)||(point.quantity!==null&&point.unit==='sem quantidade'))throw Error('Unidade da quantidade informada inválida.');
    return {id:point.id,kind:point.kind,x,y,...ends,region:text(point.region,100,true),product:text(point.product,120),quantity:point.quantity,unit:point.unit,lot:text(point.lot,80),notes:text(point.notes,2000)};
  });
  return {schemaVersion:value.schemaVersion,points,notes:text(value.notes,4000)};
}

export function toPilotMap(document){
  const source=validatePhotoAnnotation(document);
  return {points:source.schemaVersion===2?source.points.map(point=>({...point})):source.points.map(point=>({id:point.id,kind:'ponto',x:point.x,y:point.y,region:point.label,product:'',quantity:null,unit:'sem quantidade',lot:'',notes:point.notes})),notes:source.notes,sourceSchemaVersion:source.schemaVersion};
}

export function fromPilotMap(map){
  if(!map||!Array.isArray(map.points))throw Error('Mapa local inválido.');
  const keys=Object.keys(map);
  if(keys.some(key=>!['points','notes','sourceSchemaVersion'].includes(key)))throw Error('O mapa contém campos não suportados. Nenhum campo foi descartado.');
  // Do not pick known fields from the points. Validation rejects extras so an
  // unsupported future field cannot silently disappear in a cloud save.
  return validatePhotoAnnotation({schemaVersion:2,points:map.points,notes:map.notes??''});
}
