import assert from 'node:assert/strict';
import {IDBFactory} from 'fake-indexeddb';
import {openDB,write,readSnapshot,measureStoredData,STORES} from '../js/db.js';
import {recordBytes,formatBytes,measureAppCache,appStorageUsage} from '../js/storage.js';

globalThis.indexedDB=new IDBFactory();
const image=new Blob([new Uint8Array(512000)],{type:'image/png'});
const record={id:'image',blob:image,fileName:'写真🌸.png'};
assert.equal(recordBytes(record),new TextEncoder().encode(JSON.stringify({...record,blob:null})).length+512000);
assert.equal(formatBytes(1000000),'1 MB');assert.equal(formatBytes(10240*1048576),'10.74 GB');
assert.equal(formatBytes(undefined),'取得できません');assert.equal(formatBytes(0),'0 B');
console.log('PASS 画像をBase64化せず計測・日本語と絵文字のUTF-8サイズ・十進単位');

await openDB();
const snapshot={memos:[{id:'trash',body:'ゴミ箱も含める🌸',deletedAt:'2026-10-01T00:00:00Z'}],tags:[{id:'tag',name:'仕事'}],attachments:[record,{id:'undo',blob:image}],settings:[{id:'config'}],backupState:[{id:'counter',createdCount:1}]};
await write(snapshot);
const other=await new Promise((resolve,reject)=>{const request=indexedDB.open('other-app-db',1);request.onupgradeneeded=()=>request.result.createObjectStore('memos',{keyPath:'id'});request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
await new Promise(resolve=>{const tx=other.transaction('memos','readwrite');tx.objectStore('memos').put({id:'other',body:'other'.repeat(400000)});tx.oncomplete=resolve;});
const expected=STORES.reduce((total,name)=>total+snapshot[name].reduce((sum,item)=>sum+recordBytes(item),0),0);
assert.equal(await measureStoredData(recordBytes),expected);
const before=await readSnapshot();await assert.rejects(measureStoredData(()=>{throw new Error('size failed');}),/size failed/);
assert.deepEqual(await readSnapshot(),before);
const controller=new AbortController();const counting=measureStoredData(recordBytes,controller.signal);controller.abort();
await assert.rejects(counting,{name:'AbortError'});await write({settings:[{id:'config'}]});
assert.deepEqual(await readSnapshot(),before);
console.log('PASS 専用DBだけを計測・ゴミ箱と未参照画像を含む・計測失敗でもデータ不変');

const root='https://yuuuh26.github.io/flash-memo/';
const entries={
  'flash-memo-shell-old':new Map([[root+'index.html','旧版🌸']]),
  'flash-memo-shell-new':new Map([[root+'index.html','新版'],[root+'js/storage.js','module'],['https://yuuuh26.github.io/other-app/','excluded']]),
  'other-app-cache':new Map([['https://yuuuh26.github.io/other-app/','x'.repeat(1000000)]])
};
const opened=[];
const cacheStorage={keys:async()=>Object.keys(entries),open:async name=>{opened.push(name);return {keys:async()=>[...entries[name].keys()].map(url=>new Request(url))};},match:async(request,{cacheName})=>{const text=entries[cacheName].get(request.url);return text===undefined?undefined:new Response(text);}};
const expectedCache=new Blob(['旧版🌸','新版','module']).size;
assert.equal(await measureAppCache(cacheStorage,root),expectedCache);
assert.deepEqual(opened,['flash-memo-shell-old','flash-memo-shell-new']);
assert.deepEqual(await appStorageUsage(cacheStorage,root),{database:expected,cache:expectedCache,total:expected+expectedCache});
assert.deepEqual(await readSnapshot(),before);
console.log('PASS 自分のキャッシュのみ合算・旧版の重複保存を含む・他アプリの内容は取得しない');

const failed=await appStorageUsage({keys:async()=>{throw Error('unavailable');},match:async()=>{}},root);
assert.deepEqual(failed,{database:expected,cache:null,total:null});
assert.deepEqual(await appStorageUsage(undefined,root),{database:expected,cache:null,total:null});
console.log('PASS API非対応と計測失敗を0に置き換えない');
other.close();
