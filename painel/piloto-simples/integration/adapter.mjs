import { validateConfig } from './config.mjs';
import { createSessionBridge } from './session.mjs';
import { createEdgeClient } from './client.mjs';
import { IntegrationError } from './errors.mjs';
import {validatePhotoAnnotation} from './map-document.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function requireId(payload, key) {
  if (!uuid.test(payload?.[key] || '')) throw new IntegrationError('invalid_id', `Identificador inválido: ${key}.`);
}
function version(payload, key) {
  if (!Number.isInteger(payload?.[key]) || payload[key] < 1) throw new IntegrationError('version_required', 'Recarregue o registro para obter a versão atual antes de editar.');
}
function object(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new IntegrationError('invalid_payload', 'Dados inválidos.');
  return payload;
}
// Backend monetary values are DECIMAL REAIS. Local prototype cents must not
// cross this boundary implicitly. Caller supplies the documented wire fields.
export function createClinicIntegration({ config: input, authController, fetchImpl, origin, onInvalidated } = {}) {
  const config = validateConfig(input, origin);
  const session = createSessionBridge(authController, { onInvalidated });
  const client = createEdgeClient({ config, session, fetchImpl });
  const call = (endpoint, action, payload = {}) => client.request(endpoint, action, object(payload));
  const financial = (action, payload) => call('financeiro-fichas', action, payload);
  const recordsCall = (action, payload) => call('prontuario-fichas', action, payload);
  const openedMaps=new Map();
  const clearOpenedMaps=session.subscribe(()=>openedMaps.clear());
  const mapKey=(protocol,photo)=>protocol+'/'+photo;
  function checkMapResponse(response,protocol,photo){
    const binding=response.binding;
    if(binding?.protocol_id!==protocol||binding?.photo_id!==photo||!uuid.test(binding?.clinic_id||'')||!uuid.test(binding?.patient_id||'')||!Number.isInteger(binding?.protocol_version)||binding.protocol_version<1||!/^[a-f0-9]{32}$/.test(binding?.photo_revision||''))throw new IntegrationError('map_context_mismatch','O servidor retornou um vínculo diferente ou incompleto. Reabra a foto.');
    if(response.annotation){
      if(!uuid.test(response.annotation.id||'')||!Number.isInteger(response.annotation.version)||response.annotation.version<1)throw new IntegrationError('map_context_mismatch','O servidor retornou uma versão inválida. Reabra a foto.');
      validatePhotoAnnotation(response.annotation.document);
    }
    if(response.capabilities?.document_versions!==undefined&&(!Array.isArray(response.capabilities.document_versions)||!response.capabilities.document_versions.every(version=>Number.isInteger(version)&&version>0)))throw new IntegrationError('map_context_mismatch','O servidor retornou capacidades inválidas.');
  }
  const maps=Object.freeze({
    async open(protocolo_id,foto_id){
      requireId({protocolo_id},'protocolo_id');requireId({foto_id},'foto_id');
      const response=await call('foto-marcacoes-fichas','abrir',{protocolo_id,foto_id});
      checkMapResponse(response,protocolo_id,foto_id);
      openedMaps.set(mapKey(protocolo_id,foto_id),structuredClone(response));
      return response;
    },
    async save(payload){
      payload=structuredClone(object(payload));
      for(const field of ['protocolo_id','foto_id','operation_id','expected_patient_id'])requireId(payload,field);
      const opened=openedMaps.get(mapKey(payload.protocolo_id,payload.foto_id));
      if(!opened)throw new IntegrationError('map_open_required','Abra a foto pelo servidor antes de salvar marcações.');
      const binding=opened.binding;
      if(payload.expected_patient_id!==binding.patient_id||payload.expected_protocol_version!==binding.protocol_version||payload.expected_photo_revision!==binding.photo_revision||payload.expected_version!==(opened.annotation?.version??0))throw new IntegrationError('map_context_mismatch','A versão ou o vínculo mudou. Reabra a foto antes de salvar.');
      const document=validatePhotoAnnotation(payload.document);
      const versions=opened.capabilities?.document_versions??[1];
      if(!versions.includes(document.schemaVersion))throw new IntegrationError('map_version_not_deployed','O servidor desta sessão ainda aceita apenas o mapa anterior. A extensão de linha/leque e produto precisa ser implantada antes deste envio.');
      const response=await call('foto-marcacoes-fichas','salvar',{...payload,document});
      try{
        checkMapResponse(response,payload.protocolo_id,payload.foto_id);
        if(Object.keys(binding).some(key=>response.binding[key]!==binding[key])||response.annotation?.version!==payload.expected_version+1||JSON.stringify(validatePhotoAnnotation(response.annotation.document))!==JSON.stringify(document))throw Error('save response mismatch');
      }catch{
        openedMaps.delete(mapKey(payload.protocolo_id,payload.foto_id));
        throw new IntegrationError('map_save_unconfirmed','A resposta não confirmou o documento e seu vínculo. Reabra a foto para conferir antes de repetir.',{uncertain:true});
      }
      openedMaps.set(mapKey(payload.protocolo_id,payload.foto_id),structuredClone({...opened,...response}));
      return response;
    },
  });
  return Object.freeze({
    config, session, maps,
    // Feature modules still pass through the fixed-destination allowlist,
    // auth, payload snapshot, session invalidation and write guards.
    request:call,
    patients: Object.freeze({
      list: (filters = {}) => financial('listar_clientes', filters),
      get(id) { requireId({ id }, 'id'); return financial('obter_cliente', { id }); },
      create(payload) { requireId(payload, 'idempotency_key'); return financial('criar_cliente', payload); },
      update(payload) { requireId(payload, 'id'); requireId(payload, 'operation_id'); version(payload, 'versao'); return financial('editar_cliente', payload); },
    }),
    appointments: Object.freeze({
      list: (filters = {}) => call('agenda-fichas', 'listar', filters),
      create(payload) { requireId(payload, 'idempotency_key'); return call('agenda-fichas', 'criar', payload); },
      update(payload) { requireId(payload, 'id'); version(payload, 'versao'); return call('agenda-fichas', 'atualizar', payload); },
      changeStatus(payload) { requireId(payload, 'id'); version(payload, 'versao'); return call('agenda-fichas', 'marcar_status', payload); },
    }),
    records: Object.freeze({
      list: (filters = {}) => recordsCall('listar', filters),
      saveDraft(payload) {
        requireId(payload, 'paciente_id'); requireId(payload, 'idempotency_key');
        if (payload.protocolo_id) { requireId(payload, 'protocolo_id'); version(payload, 'versao_esperada'); }
        return recordsCall('criar_atualizar', payload);
      },
      finalize(payload) { requireId(payload, 'protocolo_id'); requireId(payload, 'operation_id'); version(payload, 'versao_esperada'); return recordsCall('finalizar', payload); },
    }),
    photos: Object.freeze({
      list(protocolo_id, filters = {}) { requireId({ protocolo_id }, 'protocolo_id'); return recordsCall('listar_fotos', { ...filters, protocolo_id }); },
      upload(payload) {
        requireId(payload, 'protocolo_id'); requireId(payload, 'idempotency_key');
        if (!['before','during','after','products_used'].includes(payload.fase) ||
            !(payload.arquivo instanceof Blob) || !['image/jpeg','image/png','image/webp'].includes(payload.arquivo.type) ||
            payload.arquivo.size < 1 || payload.arquivo.size > 25 * 1024 * 1024) {
          throw new IntegrationError('invalid_photo', 'Selecione uma foto JPEG, PNG ou WebP de até 25 MB e informe sua fase.');
        }
        if (payload.miniatura && (!(payload.miniatura instanceof Blob) || payload.miniatura.size > 1024 * 1024)) {
          throw new IntegrationError('invalid_thumbnail', 'A miniatura deve ter no máximo 1 MB.');
        }
        const form = new FormData();
        for (const key of ['protocolo_id','idempotency_key','fase','tirada_em','produto_id','lote','atendimento_id','item_procedimento_id','operation_id','confirmar_arquivo_distinto','motivo_duplicidade','arquivo','miniatura']) {
          const value = payload[key];
          if (value !== undefined && value !== null) form.append(key, value);
        }
        return client.request('prontuario-fichas', 'adicionar_foto', form, { multipart:true });
      },
      saveAnnotations() { throw new IntegrationError('annotations_api_unavailable', 'Use maps.open e maps.save, que conferem foto, paciente, consulta e a versão disponível no servidor. Nenhuma marcação foi enviada.'); },
    }),
    catalog: Object.freeze({ list: (filters = {}) => financial('listar_catalogos', filters) }),
    inventory: Object.freeze({ list: (filters = {}) => financial('listar_estoque', filters) }),
    finance: Object.freeze({
      summary: (filters = {}) => financial('resumo', filters),
      list: (filters = {}) => financial('listar_lancamentos', filters),
      create(payload) { requireId(payload, 'idempotency_key'); return financial('criar_lancamento', payload); },
    }),
    documents: Object.freeze({ list: () => call('painel-fichas', 'listar') }),
    operations: Object.freeze({ list: (filters = {}) => call('operacao-clinica-fichas', 'listar', filters) }),
    dispose() { clearOpenedMaps();openedMaps.clear();client.dispose(); session.destroy(); },
  });
}
