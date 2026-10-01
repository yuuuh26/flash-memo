import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {IDBFactory,IDBKeyRange,IDBDatabase} from 'fake-indexeddb';
import {blank} from '../js/model.js';
const dom=new JSDOM(await readFile(new URL('../index.html',import.meta.url),'utf8'),{url:'https://yuuuh26.github.io/flash-memo/',pretendToBeVisual:true});
const w=dom.window;globalThis.window=w;globalThis.document=w.document;globalThis.indexedDB=new IDBFactory();globalThis.IDBKeyRange=IDBKeyRange;Object.defineProperty(globalThis,'navigator',{value:w.navigator,configurable:true});w.scrollTo=()=>{};w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
const db=await import('../js/db.js');await db.openDB();const draft={...blank(),body:'アプリを閉じる前の入力途中'};
await db.write({memos:[draft],settings:[{id:'config',selectedTagIds:[],activeDraftId:draft.id}],backupState:[{id:'counter',createdCount:1,confirmedCount:0,remindedCount:0,confirmedAt:null}]});
const $=id=>document.getElementById(id);async function wait(fn){for(let i=0;i<500;i++){if(await fn())return;await new Promise(r=>setTimeout(r,10));}throw Error('timeout '+$('status').textContent);}
await import('../js/app.js');await wait(()=>$('status').textContent==='保存済み');assert.equal($('body').value,draft.body);console.log('PASS 起動時のドラフト復元');
const transaction=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(stores,mode,...rest){if(mode==='readwrite')throw new DOMException('容量不足','QuotaExceededError');return transaction.call(this,stores,mode,...rest);};
$('body').value='保存失敗しても消えない';$('body').dispatchEvent(new w.Event('input'));await wait(()=>$('status').textContent.startsWith('保存失敗'));assert.equal($('body').value,'保存失敗しても消えない');$('next').click();await wait(()=>!$('next').disabled);assert.equal($('body').value,'保存失敗しても消えない');assert.equal((await db.readSnapshot()).memos[0].body,draft.body);console.log('PASS 容量不足の明示・入力保持・次のメモへの移動阻止');
IDBDatabase.prototype.transaction=transaction;$('next').click();await wait(()=>$('body').value==='');assert.equal((await db.readSnapshot()).memos[0].body,'保存失敗しても消えない');console.log('PASS 保存再試行でデータを確定');w.close();process.exit(0);
