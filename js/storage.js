import {measureStoredData} from './db.js';

const encoder=new TextEncoder();
// Logical data size: UTF-8 JSON metadata plus raw Blob bytes, never Base64.
// IndexedDB indexes, compression and browser bookkeeping are not measurable here.
export function recordBytes(record){
  let blobs=0;
  const json=JSON.stringify(record,(_key,value)=>{
    if(value instanceof Blob){blobs+=value.size;return null;}
    return value;
  });
  return encoder.encode(json).byteLength+blobs;
}

export function formatBytes(bytes){
  if(!Number.isFinite(bytes)||bytes<0)return '取得できません';
  const units=['B','KB','MB','GB','TB'];let unit=0;
  while(bytes>=1000&&unit<units.length-1){bytes/=1000;unit++;}
  return `${bytes.toLocaleString('ja-JP',{maximumFractionDigits:unit?2:0})} ${units[unit]}`;
}

export async function measureAppCache(cacheStorage,root,signal){
  if(!cacheStorage?.keys||!cacheStorage?.match)throw new Error('Cache Storage is unavailable');
  let bytes=0;
  for(const name of await cacheStorage.keys()){
    if(signal?.aborted)throw new DOMException('計測を中止しました。','AbortError');
    if(!name.startsWith('flash-memo-shell-'))continue;
    // Opening an existing cache only; no reads of other apps' caches.
    const cache=await cacheStorage.open(name);
    for(const request of await cache.keys()){
      if(signal?.aborted)throw new DOMException('計測を中止しました。','AbortError');
      if(!request.url.startsWith(root))continue;
      const response=await cacheStorage.match(request,{cacheName:name});
      if(response){if(response.type==='opaque')throw new Error('Cache size is unavailable');bytes+=(await response.blob()).size;}
    }
  }
  return bytes;
}

export async function appStorageUsage(cacheStorage,root,signal){
  const results=await Promise.allSettled([measureStoredData(recordBytes,signal),measureAppCache(cacheStorage,root,signal)]);
  const database=results[0].status==='fulfilled'?results[0].value:null;
  const cache=results[1].status==='fulfilled'?results[1].value:null;
  return {database,cache,total:database!==null&&cache!==null?database+cache:null};
}
