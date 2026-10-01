export const STORES = ['memos','tags','attachments','settings','backupState'];
let connection;
export function openDB(){
  return new Promise((resolve,reject)=>{
    const request=indexedDB.open('flash-memo-db',1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      for(const name of STORES) if(!db.objectStoreNames.contains(name)) db.createObjectStore(name,{keyPath:'id'});
      const memos=request.transaction.objectStore('memos');
      if(!memos.indexNames.contains('createdAt')) memos.createIndex('createdAt','createdAt');
      if(!memos.indexNames.contains('updatedAt')) memos.createIndex('updatedAt','updatedAt');
    };
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('別のFLASH MEMOを閉じてから再度開いてください。'));
    request.onsuccess=()=>{connection=request.result;connection.onversionchange=()=>connection.close();resolve(connection);};
  });
}
export function readSnapshot(){
  return new Promise((resolve,reject)=>{
    const tx=connection.transaction(STORES,'readonly');const result={};
    for(const name of STORES){const r=tx.objectStore(name).getAll();r.onsuccess=()=>result[name]=r.result;}
    tx.oncomplete=()=>resolve(result);tx.onabort=()=>reject(tx.error);
  });
}
// All writes resolve only on transaction completion. No await inside the transaction.
export function write(changes,replace=false){
  return new Promise((resolve,reject)=>{
    let tx;
    try{
      tx=connection.transaction(STORES,'readwrite',{durability:'strict'});
      for(const name of STORES){
        const store=tx.objectStore(name);if(replace)store.clear();
        for(const item of changes[name]||[])store.put(item);
        for(const id of changes.remove?.[name]||[])store.delete(id);
      }
    }catch(error){if(tx)tx.abort();reject(error);return;}
    tx.oncomplete=()=>resolve();tx.onabort=()=>reject(tx.error||new Error('保存できませんでした。'));
  });
}
