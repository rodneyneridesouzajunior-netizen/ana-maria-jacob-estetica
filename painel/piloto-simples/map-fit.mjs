export function fittedPhotoSize(stageWidth,stageHeight,imageWidth,imageHeight,zoom=1){
  if(![stageWidth,stageHeight,imageWidth,imageHeight].every(value=>Number.isFinite(value)&&value>0))return null;
  if(!Number.isFinite(zoom))return null;
  const scale=Math.max(1,Math.min(3,zoom)),aspect=imageWidth/imageHeight;
  const baseWidth=Math.min(stageWidth,stageHeight*aspect);
  return{width:baseWidth*scale,height:baseWidth/aspect*scale,zoom:scale};
}
