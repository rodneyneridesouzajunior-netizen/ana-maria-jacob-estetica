export const SCHEMA = 1;
export const dateKey = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export function cents(value) {
  const text = String(value).trim().replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw Error('Informe um valor positivo com até duas casas decimais.');
  const [whole, fraction=''] = text.split('.');
  const result = Number(whole)*100 + Number(fraction.padEnd(2,'0'));
  if (!Number.isSafeInteger(result) || result > 100000000) throw Error('Valor fora do limite do piloto.');
  return result;
}
export function appointmentCheck(item, items, patients) {
  if (!patients.some(p=>p.id===item.patientId)) throw Error('Selecione uma paciente cadastrada.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(item.time)) throw Error('Confira a data e o horário.');
  const parsed = new Date(item.date+'T12:00:00');
  if (Number.isNaN(+parsed) || dateKey(parsed)!==item.date) throw Error('Data inválida.');
  if (!Number.isInteger(item.duration) || item.duration<5 || item.duration>480) throw Error('A duração deve ficar entre 5 e 480 minutos.');
  if (!item.service?.trim() || item.service.length>120) throw Error('Informe o atendimento.');
  const minutes = t=>Number(t.slice(0,2))*60+Number(t.slice(3));
  const start=minutes(item.time), end=start+item.duration;
  if(end>1440) throw Error('O atendimento deve terminar no mesmo dia.');
  if(items.some(a=>a.id!==item.id&&a.date===item.date&&a.status!=='cancelado'&&start<minutes(a.time)+a.duration&&end>minutes(a.time))) throw Error('Já existe um atendimento nesse intervalo. Escolha outro horário.');
  return item;
}
export function normalizedPoint(clientX, clientY, rect) {
  if (!(rect.width>0 && rect.height>0)) throw Error('A foto ainda não está pronta.');
  return {x:Math.max(0,Math.min(1,(clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(clientY-rect.top)/rect.height))};
}
export const MAX_TRACE_VERTICES = 256;
export const DEFAULT_FAN_SPREAD = 48;
/** Absence preserves old visit inheritance; explicit null is never inheritance. */
export function markingProcedureBinding(point){
  const keys=['procedureId','procedureVersion','procedureSnapshot'],present=keys.filter(key=>Object.hasOwn(point,key));
  if(!present.length)return {mode:'inherit',snapshot:null};
  if(present.length===3&&keys.every(key=>point[key]===null))return {mode:'none',snapshot:null};
  const snapshot=point.procedureSnapshot,validId=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,179}$/.test(value)&&!['constructor','prototype','__proto__'].includes(value);
  if(present.length!==3||!validId(point.procedureId)||!Number.isSafeInteger(point.procedureVersion)||point.procedureVersion<1||!snapshot||typeof snapshot!=='object'||Array.isArray(snapshot)||snapshot.id!==point.procedureId||snapshot.version!==point.procedureVersion||typeof snapshot.name!=='string'||!snapshot.name.trim()||snapshot.name.length>120)throw Error('Confira o procedimento e a versão preservada da marcação.');
  for(const key of ['price','cost'])if(!Number.isSafeInteger(snapshot[key])||snapshot[key]<0||snapshot[key]>100000000)throw Error('Valor do procedimento da marcação inválido.');
  if(!Number.isSafeInteger(snapshot.duration)||snapshot.duration<5||snapshot.duration>480||snapshot.recordMode!==undefined&&!['injectable','non_injectable','simple'].includes(snapshot.recordMode))throw Error('Registro do procedimento da marcação inválido.');
  if(snapshot.requiredDocumentIds!==undefined&&(!Array.isArray(snapshot.requiredDocumentIds)||snapshot.requiredDocumentIds.length>20||new Set(snapshot.requiredDocumentIds).size!==snapshot.requiredDocumentIds.length||snapshot.requiredDocumentIds.some(id=>!validId(id)))||snapshot.consentTemplateId!==undefined&&snapshot.consentTemplateId!==''&&!validId(snapshot.consentTemplateId))throw Error('Documentos do procedimento da marcação inválidos.');
  return {mode:'explicit',snapshot};
}
function checkFanSpread(point){
  if(Object.hasOwn(point,'fanSpread')&&(point.kind!=='leque'||!Number.isFinite(point.fanSpread)||point.fanSpread<=0||point.fanSpread>120))throw Error('A abertura do leque deve ser maior que 0 e até 120 graus.');
}
/** Three open rays in normalized photo coordinates; no stored point is changed.
 * Legacy fans keep their original fixed-width endpoints. New fans rotate the
 * exact central vector in photo space, independently of zoom or screen size.
 * Outer tips may leave the photo: renderers clip them, never clamp the geometry.
 */
export function fanRays(point,aspectRatio=1){
  if(!point||point.kind!=='leque'||!['x','y','x2','y2'].every(key=>Number.isFinite(point[key])&&point[key]>=0&&point[key]<=1))throw Error('Geometria do leque inválida.');
  checkFanSpread(point);
  if(!Number.isFinite(aspectRatio)||aspectRatio<=0)throw Error('Proporção da fotografia inválida.');
  const dx=point.x2-point.x,dy=point.y2-point.y;
  let tips;
  if(!Object.hasOwn(point,'fanSpread')){
    const length=Math.hypot(dx,dy)||1,nx=-dy/length*.055,ny=dx/length*.055;
    tips=[{x:point.x2+nx,y:point.y2+ny},{x:point.x2,y:point.y2},{x:point.x2-nx,y:point.y2-ny}];
  }else{
    const half=point.fanSpread*Math.PI/360,cos=Math.cos(half),sin=Math.sin(half);
    tips=[{x:point.x+dx*cos+dy*sin/aspectRatio,y:point.y-dx*aspectRatio*sin+dy*cos},
      {x:point.x2,y:point.y2},
      {x:point.x+dx*cos-dy*sin/aspectRatio,y:point.y+dx*aspectRatio*sin+dy*cos}];
  }
  if(tips.some(tip=>!Number.isFinite(tip.x)||!Number.isFinite(tip.y)))throw Error('Geometria do leque fora do limite de representação.');
  return tips.map(tip=>({x1:point.x,y1:point.y,x2:tip.x,y2:tip.y}));
}
export function annotationCheck(point) {
  if(!['ponto','linha','leque','traco'].includes(point.kind)) throw Error('Marcação inválida.');
  markingProcedureBinding(point);
  checkFanSpread(point);
  for(const key of ['x','y',...(['ponto','traco'].includes(point.kind)?[]:['x2','y2'])]) if(!Number.isFinite(point[key])||point[key]<0||point[key]>1) throw Error('Marcação fora da imagem.');
  if(point.kind==='traco'){
    // Store bounded normalized vertices, never executable SVG or screen pixels.
    if(Object.hasOwn(point,'x2')||Object.hasOwn(point,'y2')||!Array.isArray(point.vertices)||point.vertices.length<2||point.vertices.length>MAX_TRACE_VERTICES) throw Error('O traço precisa de 2 a 256 vértices, sem extremidade de linha.');
    for(const vertex of point.vertices)if(!vertex||typeof vertex!=='object'||Array.isArray(vertex)||Object.keys(vertex).length!==2||!Object.hasOwn(vertex,'x')||!Object.hasOwn(vertex,'y')||!Number.isFinite(vertex.x)||!Number.isFinite(vertex.y)||vertex.x<0||vertex.x>1||vertex.y<0||vertex.y>1) throw Error('Vértice do traço fora da imagem ou inválido.');
    if(point.x!==point.vertices[0].x||point.y!==point.vertices[0].y) throw Error('A posição do traço deve coincidir com o primeiro vértice.');
    if(point.quantity!==null||point.unit!=='sem quantidade') throw Error('O traço é uma anotação visual, sem quantidade ou consumo de produto.');
  }
  if(!point.region?.trim()||point.region.length>100) throw Error('Dê um nome à região.');
  if((point.product||'').length>120||(point.notes||'').length>2000||(point.lot||'').length>80) throw Error('Texto muito longo.');
  if(point.quantity!==null && (!Number.isFinite(point.quantity)||point.quantity<=0||point.quantity>100000)) throw Error('Quantidade inválida.');
  if(!['mL','U','mg','g','un','fios','sem quantidade'].includes(point.unit)) throw Error('Selecione a unidade.');
  if(point.quantity!==null&&point.unit==='sem quantidade') throw Error('Escolha a unidade da quantidade informada.');
  return point;
}
export function translateAnnotation(point, target) {
  annotationCheck(point);
  if(!Number.isFinite(target.x)||!Number.isFinite(target.y)) throw Error('Posição inválida.');
  const xs=point.kind==='traco'?point.vertices.map(v=>v.x):point.kind==='ponto'?[point.x]:[point.x,point.x2];
  const ys=point.kind==='traco'?point.vertices.map(v=>v.y):point.kind==='ponto'?[point.y]:[point.y,point.y2];
  const dx=Math.max(-Math.min(...xs),Math.min(1-Math.max(...xs),target.x-point.x));
  const dy=Math.max(-Math.min(...ys),Math.min(1-Math.max(...ys),target.y-point.y));
  const next={...point,x:point.x+dx,y:point.y+dy};
  if(point.kind==='traco'){
    // The shared displacement preserves the stroke; the final clamp only absorbs
    // floating-point rounding at an image boundary.
    next.vertices=point.vertices.map(v=>({x:Math.max(0,Math.min(1,v.x+dx)),y:Math.max(0,Math.min(1,v.y+dy))}));
    next.x=next.vertices[0].x;next.y=next.vertices[0].y;
  }else if(point.kind!=='ponto'){next.x2=point.x2+dx;next.y2=point.y2+dy;}
  return annotationCheck(next);
}
export function quantityTotals(points) {
  const totals={};
  for(const p of points) if(p.quantity!==null&&p.quantity!==undefined) totals[p.unit]=Math.round(((totals[p.unit]||0)+p.quantity)*10000)/10000;
  return totals;
}
export function billBalance(bill, payments) { return bill.cancelledAt?0:bill.total-payments.filter(p=>p.billId===bill.id&&!p.reversedAt).reduce((a,p)=>a+p.amount,0); }
export function paymentCheck(payment, state) {
  const bill=state.bills.find(b=>b.id===payment.billId);
  if(!bill || bill.cancelledAt || !Number.isSafeInteger(payment.amount)||payment.amount<=0) throw Error('Recebimento inválido.');
  if(state.payments.some(p=>p.operationId===payment.operationId)) throw Error('Este recebimento já foi registrado.');
  if(payment.amount>billBalance(bill,state.payments)) throw Error('O valor excede o saldo a receber.');
  if(!['Pix','Dinheiro','Cartão'].includes(payment.method)) throw Error('Escolha a forma de recebimento.');
  return payment;
}
export function financialSummary(state) {
  const received=state.payments.filter(p=>!p.reversedAt).reduce((n,p)=>n+p.amount,0), billed=state.bills.filter(b=>!b.cancelledAt).reduce((n,b)=>n+b.total,0);
  const costs=state.bills.filter(b=>!b.cancelledAt).reduce((n,b)=>n+(b.cost||0),0);
  return {received,billed,outstanding:billed-received,variableCosts:costs,contribution:billed-costs};
}
export function seed() {
  const today=dateKey();
  return {schema:SCHEMA,revision:0,patients:[{id:'demo-marina',name:'Marina Oliveira · exemplo',phone:'',notes:''},{id:'demo-beatriz',name:'Beatriz Costa · exemplo',phone:'',notes:''},{id:'demo-lucia',name:'Lúcia Martins · exemplo',phone:'',notes:''}],appointments:[{id:'demo-ag1',patientId:'demo-marina',date:today,time:'09:00',duration:60,service:'Avaliação facial',status:'confirmado'},{id:'demo-ag2',patientId:'demo-beatriz',date:today,time:'11:00',duration:60,service:'Atendimento estético',status:'agendado'},{id:'demo-ag3',patientId:'demo-lucia',date:today,time:'15:00',duration:45,service:'Retorno',status:'agendado'}],visits:[{id:'demo-consulta',patientId:'demo-marina',appointmentId:'demo-ag1',date:today,service:'Avaliação facial',notes:'Consulta fictícia para experimentar o fluxo. Nenhuma informação clínica real.',status:'rascunho',photos:[{id:'demo-foto',src:'assets/face-demonstrativa.png',label:'Frontal · imagem fictícia',phase:'antes',revision:'demo-v1',width:1122,height:1402}],maps:{'demo-foto':{version:0,points:[],history:[]}}}],bills:[{id:'demo-bill',patientId:'demo-marina',visitId:'demo-consulta',date:today,description:'Exemplo de atendimento',total:50000,cost:12000}],payments:[{id:'demo-pix',operationId:'demo-pix-op',billId:'demo-bill',date:today,amount:20000,method:'Pix'}]};
}
