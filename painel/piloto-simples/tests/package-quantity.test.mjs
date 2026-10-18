import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyState} from '../../../supabase/functions/app-workspace/rules.mjs';
import {saveProduct,receiveLot,packageQuantity,productUnitCost} from '../operations-domain.mjs';
import {validateBackupState} from '../backup.mjs';
import {productForm,renderCatalogList} from '../operations-ui.mjs';
const now='2026-10-18T18:00:00.000Z',today='2026-10-18';
const op=(id,data)=>({operationId:id,data,now,today});
const product={id:'p',name:'Produto isolado',brand:'Marca',unit:'mL',unitCost:4000,usage:'material',active:false};
test('conteúdo por embalagem salva 2, 5 e decimais BR e reaparece após serializar',()=>{
 const s=emptyState();
 for(const [i,value] of ['2','5','2,5','0,0001','1.2345'].entries()){
  saveProduct(s,op('save'+i,{...product,packageQuantity:value,expectedVersion:i}));
  const copy=JSON.parse(JSON.stringify(s)),expected=Number(value.replace(',','.'));
  assert.equal(copy.products[0].packageQuantity,expected);validateBackupState(copy);
  assert.match(productForm(copy,'p').body,new RegExp('name="packageQuantity"[^>]*value="'+String(expected).replace('.',',')+'"'));
  assert.match(renderCatalogList(copy,{section:'products',query:'',status:'all'}),/por embalagem/);
 }
});
test('produto legado continua sem valor inventado; cliente antigo preserva campo e campo vazio limpa só metadado',()=>{
 const s=emptyState();saveProduct(s,op('old',product));validateBackupState(s);
 assert.equal(s.products[0].packageQuantity,undefined);
 assert.match(renderCatalogList(s,{section:'products',query:'',status:'all'}),/Quantidade por embalagem não informada/);
 saveProduct(s,op('add',{...product,packageQuantity:'5',expectedVersion:1}));
 saveProduct(s,op('legacy',{...product,expectedVersion:2}));assert.equal(s.products[0].packageQuantity,5);
 saveProduct(s,op('clear',{...product,packageQuantity:'',expectedVersion:3}));assert.equal(s.products[0].packageQuantity,null);validateBackupState(s);
});
test('quantidade inválida aborta sem efeitos; servidor recusa payload inválido direto',()=>{
 for(const value of ['0','-2','2,12345','2,5abc','1,2,3','NaN','Infinity','100000001',true,{},[]]){
  const s=emptyState(),before=structuredClone(s);assert.throws(()=>saveProduct(s,op('bad',{...product,packageQuantity:value})),/Quantidade por embalagem/);assert.deepEqual(s,before);
 }
 for(const value of [0,-2,2.12345,'5',true,{},Infinity,NaN]){
  const s=emptyState();saveProduct(s,op('p',product));s.products[0].packageQuantity=value;assert.throws(()=>validateBackupState(s),/Quantidade por embalagem|Número inválido/);
 }
});
test('alterar embalagem preserva estoque, custos, demais campos e históricos; calculadora usa mesma quantidade',()=>{
 const s=emptyState();saveProduct(s,op('p',{...product,active:true}));
 receiveLot(s,op('lot',{id:'lot',productId:'p',code:'ISOLADO',expiry:'2027-10-18',quantity:'20',unitCost:2500}));
 const before=structuredClone(s);saveProduct(s,op('edit',{...product,active:true,expectedVersion:1,packageQuantity:'2,5'}));
 for(const key of Object.keys(before).filter(k=>!['products','operationHistory'].includes(k)))assert.deepEqual(s[key],before[key],key);
 for(const key of ['name','brand','unit','unitCost','usage','active'])assert.equal(s.products[0][key],before.products[0][key]);
 assert.equal(productUnitCost(10000,packageQuantity('2,5')),4000);
 assert.equal((productForm(s,'p').body.match(/name="packageQuantity"/g)||[]).length,1);
 validateBackupState(s);
});
