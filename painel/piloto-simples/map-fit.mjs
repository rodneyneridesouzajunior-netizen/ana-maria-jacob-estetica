export const MAP_ZOOM_LEVELS=Object.freeze([1,3,6,10]);
export function fittedPhotoSize(stageWidth,stageHeight,imageWidth,imageHeight,zoom=1){
  if(![stageWidth,stageHeight,imageWidth,imageHeight].every(value=>Number.isFinite(value)&&value>0))return null;
  if(!Number.isFinite(zoom))return null;
  const scale=Math.max(MAP_ZOOM_LEVELS[0],Math.min(MAP_ZOOM_LEVELS.at(-1),zoom)),aspect=imageWidth/imageHeight;
  const baseWidth=Math.min(stageWidth,stageHeight*aspect);
  return{width:baseWidth*scale,height:baseWidth/aspect*scale,zoom:scale};
}
