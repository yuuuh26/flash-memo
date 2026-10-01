import {VERSION} from './model.js';
export function blobData(blob){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(r.error);r.readAsDataURL(blob);});}
export async function exportData(snapshot){
  return {schemaVersion:1,appVersion:VERSION,exportedAt:new Date().toISOString(),...snapshot,attachments:await Promise.all(snapshot.attachments.map(async({blob,...a})=>({...a,dataUrl:await blobData(blob)})))};
}
const fail=()=>{throw new Error('バックアップの形式または参照データが不正です。既存データは変更していません。');};
const validDate=s=>typeof s==='string'&&Number.isFinite(Date.parse(s));
const stringArray=v=>Array.isArray(v)&&v.every(s=>typeof s==='string')&&new Set(v).size===v.length;
export function validateBackup(data){
  if(!data||data.schemaVersion!==1||typeof data.appVersion!=='string'||!validDate(data.exportedAt))fail();
  for(const name of ['memos','tags','attachments','settings','backupState']){
    if(!Array.isArray(data[name]))fail();
    const ids=new Set();for(const row of data[name]){if(!row||typeof row.id!=='string'||!row.id||ids.has(row.id))fail();ids.add(row.id);}
  }
  const tags=new Set(data.tags.map(t=>t.id));const attachments=new Map(data.attachments.map(a=>[a.id,a]));const memos=new Set(data.memos.map(m=>m.id));
  for(const t of data.tags)if(typeof t.name!=='string'||!t.name.trim()||typeof t.quick!=='boolean'||!Number.isFinite(t.quickOrder)||!Number.isFinite(t.order)||!validDate(t.createdAt)||!validDate(t.updatedAt))fail();
  for(const m of data.memos){
    if(typeof m.body!=='string'||!validDate(m.createdAt)||!validDate(m.updatedAt)||!stringArray(m.tagIds)||!stringArray(m.attachmentIds)||!stringArray(m.mergedFromIds)||!(m.deletedAt===null||validDate(m.deletedAt))||m.tagIds.some(id=>!tags.has(id))||m.attachmentIds.some(id=>attachments.get(id)?.memoId!==m.id)||m.mergedAt!==undefined&&!validDate(m.mergedAt))fail();
  }
  for(const a of data.attachments){
    if(!memos.has(a.memoId)||!data.memos.find(m=>m.id===a.memoId).attachmentIds.includes(a.id)||typeof a.type!=='string'||!a.type.startsWith('image/')||typeof a.fileName!=='string'||!validDate(a.createdAt)||typeof a.dataUrl!=='string')fail();
    const match=/^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(a.dataUrl);if(!match||match[1]!==a.type||match[2].length%4!==0)fail();
    try{atob(match[2]);}catch{fail();}
  }
  const config=data.settings.find(s=>s.id==='config');const count=data.backupState.find(s=>s.id==='counter');
  if(!config||!stringArray(config.selectedTagIds)||config.selectedTagIds.some(id=>!tags.has(id))||!(config.activeDraftId===null||memos.has(config.activeDraftId)))fail();
  if(!count||!Number.isSafeInteger(count.createdCount)||count.createdCount<0||!Number.isSafeInteger(count.confirmedCount)||count.confirmedCount<0||count.confirmedCount>count.createdCount||!Number.isSafeInteger(count.remindedCount)||count.remindedCount<0||count.remindedCount>count.createdCount||!(count.confirmedAt===null||validDate(count.confirmedAt)))fail();
  return data;
}
export function decodeBackup(data){
  validateBackup(data);
  return {...data,attachments:data.attachments.map(({dataUrl,...a})=>{const raw=atob(dataUrl.split(',')[1]);return {...a,blob:new Blob([Uint8Array.from(raw,c=>c.charCodeAt(0))],{type:a.type})};})};
}
export function combineBackup(existing,incoming){
  // Same IDs keep the current records. New attachments are accepted only if referenced
  // by the selected memo, so an ID conflict cannot corrupt existing image relations.
  const result={};for(const name of ['memos','tags']){const map=new Map(incoming[name].map(x=>[x.id,x]));existing[name].forEach(x=>map.set(x.id,x));result[name]=[...map.values()];}
  const amap=new Map(existing.attachments.map(a=>[a.id,a]));
  for(const a of incoming.attachments){const memo=result.memos.find(m=>m.id===a.memoId);if(!amap.has(a.id)&&memo?.attachmentIds.includes(a.id))amap.set(a.id,a);}
  // A new memo colliding with an existing attachment ID must not steal its image.
  result.memos=result.memos.map(m=>({...m,attachmentIds:m.attachmentIds.filter(id=>amap.get(id)?.memoId===m.id)}));
  result.attachments=[...amap.values()];result.settings=existing.settings;result.backupState=existing.backupState;return result;
}
export function download(data,prefix='flash-memo-backup'){
  const date=new Date();const stamp=date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')+'_'+String(date.getHours()).padStart(2,'0')+String(date.getMinutes()).padStart(2,'0');
  const url=URL.createObjectURL(new Blob([JSON.stringify(data)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${prefix}_${stamp}.json`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return a.download;
}
