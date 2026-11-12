// A document contains only annotations. Images, credentials and inferred anatomy
// never belong in the persisted document. Coordinates refer to the original photo.
export const MAX_PHOTO_POINTS = 200;
const pointId = /^[A-Za-z0-9_-]{1,64}$/;
function exactKeys(value, keys) {
  return value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}
function text(value, maximum) {
  if (typeof value !== 'string' || Array.from(value).length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw new Error('Texto da marcação inválido ou acima do limite.');
  }
  return value;
}
export function emptyPhotoAnnotation() { return {schemaVersion:1,points:[],notes:''}; }
export function validatePhotoAnnotation(value) {
  if (!exactKeys(value, ['schemaVersion','points','notes']) || value.schemaVersion !== 1 ||
      !Array.isArray(value.points) || value.points.length > MAX_PHOTO_POINTS) {
    throw new Error('Documento de marcações inválido. Use a versão 1 e até 200 pontos.');
  }
  const ids = new Set();
  const points = value.points.map(point => {
    if (!exactKeys(point, ['id','x','y','label','notes']) || typeof point.id !== 'string' || !pointId.test(point.id) || ids.has(point.id) ||
        typeof point.x !== 'number' || !Number.isFinite(point.x) || point.x < 0 || point.x > 1 ||
        typeof point.y !== 'number' || !Number.isFinite(point.y) || point.y < 0 || point.y > 1) {
      throw new Error('Ponto inválido. As coordenadas devem estar entre zero e um e os identificadores devem ser únicos.');
    }
    ids.add(point.id);
    return {id:point.id,x:point.x,y:point.y,label:text(point.label,100),notes:text(point.notes,2000)};
  });
  return {schemaVersion:1,points,notes:text(value.notes,4000)};
}
