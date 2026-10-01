import {openDB,readSnapshot,write} from './db.js';
import {uid,now,blank,hasContent,title,date,mergeMemos,History} from './model.js';
import {exportData,decodeBackup,combineBackup,download} from './backup.js';
import {appStorageUsage,formatBytes} from './storage.js';
const $=id=>document.getElementById(id);
const escape=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,config,counter,current,history,view='write',revision=0,timer,queue=Promise.resolve(),writer=false,selecting=false,selected=new Set(),tagSelection=new Set(),filters=[],urls=[],pendingExport=null,installEvent,attachmentBusy=false;
let ready=false;
let storageRefresh=0,storageAbort;
const toast=text=>{$('toast').textContent=text;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,2600);};
function failure(error){$('status').textContent='保存失敗 · 入力はこの画面に残っています';$('status').className='error';toast(error?.name==='QuotaExceededError'?'保存容量が不足しています。バックアップ後に不要なデータを整理してください。':error.message||'保存に失敗しました。');}
function enqueue(fn){const p=queue.then(fn);queue=p.catch(()=>{});return p;}
const guard=fn=>async(...args)=>{try{if(!ready)throw new Error('準備中です。少しお待ちください。');if(!writer)throw new Error('別のFLASH MEMOが開いています。そちらを閉じてから再読み込みしてください。');return await fn(...args);}catch(error){failure(error);}};
const getTags=ids=>ids.map(id=>data.tags.find(t=>t.id===id)).filter(Boolean);
const orderedTags=()=>[...data.tags].sort((a,b)=>a.order-b.order);
const stateOf=m=>({body:m.body,tagIds:[...m.tagIds],attachmentIds:[...m.attachmentIds]});
const configRow=()=>({...config,selectedTagIds:[...config.selectedTagIds]});
function resized(){const area=$('body');area.style.height='auto';area.style.height=Math.max(240,area.scrollHeight)+'px';$('characters').textContent=`${area.value.length.toLocaleString()}文字`;}
function historyButtons(){$('undo').disabled=history.index===0;$('redo').disabled=history.index===history.items.length-1;}
function markChanged(push=true){revision++;if(push)history.push(stateOf(current));historyButtons();$('status').textContent='保存待ち…';$('status').className='';clearTimeout(timer);timer=setTimeout(()=>flush().catch(failure),400);}
async function flush(){
  clearTimeout(timer);
  return enqueue(async()=>{
    let savedRevision;
    do{
      savedRevision=revision;const memo=structuredClone(current);const settings=configRow();
      const stored=data.memos.find(m=>m.id===memo.id);
      if(!hasContent(memo)&&!stored){await write({settings:[settings]});data.settings=[settings];if(savedRevision===revision)$('status').textContent='入力すると自動保存';continue;}
      if(stored&&JSON.stringify(stateOf(stored))===JSON.stringify(stateOf(memo))){await write({settings:[settings]});data.settings=[settings];if(savedRevision===revision){$('status').textContent='保存済み';$('status').className='';}continue;}
      const isNew=!stored;memo.updatedAt=now();
      const nextCounter={...counter,createdCount:counter.createdCount+(isNew?1:0)};
      $('status').textContent='保存中…';
      await write({memos:[memo],settings:[settings],backupState:[nextCounter]});
      data.memos=data.memos.filter(m=>m.id!==memo.id).concat(memo);counter=nextCounter;data.backupState=[counter];data.settings=[settings];
      if(current.id===memo.id&&savedRevision===revision){current.updatedAt=memo.updatedAt;$('status').textContent='保存済み';$('status').className='';}
    }while(savedRevision!==revision);
    updateCount();
  });
}
function updateCount(){$('count').textContent=`${data.memos.filter(m=>!m.deletedAt).length}件`;}
function renderTags(){
  const quick=[...data.tags].filter(t=>t.quick).sort((a,b)=>a.quickOrder-b.quickOrder);
  $('quickTags').replaceChildren();
  for(const tag of quick){const button=document.createElement('button');button.className='chip'+(current.tagIds.includes(tag.id)?' selected':'');button.textContent=tag.name;button.setAttribute('aria-pressed',current.tagIds.includes(tag.id));button.onpointerdown=e=>e.preventDefault();button.onclick=guard(()=>toggleTag(tag.id));$('quickTags').append(button);}
  if(!quick.length){const p=document.createElement('span');p.className='muted';p.textContent='設定でよく使うタグを追加できます';$('quickTags').append(p);}
  $('selectedTags').textContent=getTags(current.tagIds).map(t=>'#'+t.name).join('  ');
}
function toggleTag(id){current.tagIds=current.tagIds.includes(id)?current.tagIds.filter(x=>x!==id):[...current.tagIds,id];config.selectedTagIds=[...current.tagIds];markChanged();renderTags();$('body').focus({preventScroll:true});}
function renderImages(){
  for(const url of urls)URL.revokeObjectURL(url);urls=[];$('images').replaceChildren();
  for(const id of current.attachmentIds){const image=data.attachments.find(a=>a.id===id);if(!image)continue;const url=URL.createObjectURL(image.blob);urls.push(url);const tile=document.createElement('div');tile.className='image-tile';const img=document.createElement('img');img.src=url;img.alt=image.fileName;img.tabIndex=0;img.onclick=()=>showImage(image);img.onkeydown=e=>{if(e.key==='Enter')showImage(image);};const remove=document.createElement('button');remove.textContent='画像を削除';remove.onclick=guard(async()=>{await flush();confirmDialog('画像を削除しますか？','Undoで戻せます。メモ本文は残ります。',guard(async()=>{current.attachmentIds=current.attachmentIds.filter(x=>x!==id);markChanged();renderImages();await flush();}));});tile.append(img,remove);$('images').append(tile);}
}
function showImage(image){const url=URL.createObjectURL(image.blob);dialog('<h2>添付画像</h2><img alt="添付画像">');$('dialogContent').querySelector('img').src=url;$('dialog').addEventListener('close',()=>URL.revokeObjectURL(url),{once:true});}
function renderEditor(){ $('body').value=current.body;$('editorLabel').textContent=data.memos.some(m=>m.id===current.id)?'EDIT MEMO':'NEW MEMO';renderTags();renderImages();resized();historyButtons();}
async function changeView(nextView){if(nextView!=='settings'){storageAbort?.abort();storageRefresh++;}await flush();view=nextView;for(const el of document.querySelectorAll('.view'))el.hidden=el.id!==view;for(const el of document.querySelectorAll('nav button'))el.classList.toggle('active',el.dataset.view===view);if(view==='list')renderList();if(view==='settings')renderSettings();if(view==='write'){resized();$('body').focus({preventScroll:true});}}
function dialog(html){$('dialogContent').innerHTML=html;if(!$('dialog').open)$('dialog').showModal();}
function closeDialog(){$('dialog').close();if(view==='write')$('body').focus({preventScroll:true});}
function confirmDialog(heading,text,action){dialog(`<h2>${escape(heading)}</h2><p>${escape(text)}</p><button id="confirmAction" class="primary">実行する</button>`);$('confirmAction').onclick=async()=>{const button=$('confirmAction');button.disabled=true;await action();closeDialog();};}
function tagDialog(heading,ids,apply,{mode='set',extra=''}={}){
  const choices=new Set(ids);dialog(`<h2>${escape(heading)}</h2>${extra}<div id="tagChoices" class="chips"></div><button id="applyTags" class="primary">適用</button>`);
  function render(){ $('tagChoices').replaceChildren();for(const t of orderedTags()){const b=document.createElement('button');b.className='chip'+(choices.has(t.id)?' selected':'');b.textContent=t.name;b.setAttribute('aria-pressed',choices.has(t.id));b.onclick=()=>{choices.has(t.id)?choices.delete(t.id):choices.add(t.id);render();};$('tagChoices').append(b);}if(!data.tags.length)$('tagChoices').textContent='設定・管理からタグを作成できます。';}
  render();$('applyTags').onclick=guard(async()=>{await apply([...choices],mode==='bulk'?$('tagOperation').value:'set');closeDialog();});
}
async function nextMemo(){
  if(attachmentBusy)throw new Error('画像の保存が終わってから次へ進んでください。');
  $('next').disabled=true;try{await flush();const ids=[...current.tagIds];current=blank(ids);config.selectedTagIds=ids;config.activeDraftId=current.id;revision++;history.reset(stateOf(current));renderEditor();$('status').textContent='入力すると自動保存';$('body').focus({preventScroll:true});window.scrollTo({top:0});await enqueue(()=>write({settings:[configRow()]}));maybeReminder();}finally{$('next').disabled=false;}
}
function maybeReminder(){if(counter.createdCount-counter.confirmedCount>=15&&counter.createdCount-counter.remindedCount>=15)$('reminder').hidden=false;}
async function postponeReminder(){const c={...counter,remindedCount:counter.createdCount};await enqueue(()=>write({backupState:[c]}));counter=c;$('reminder').hidden=true;}
async function openMemo(id){if(attachmentBusy)throw new Error('画像の保存中です。');await flush();const memo=data.memos.find(m=>m.id===id);if(!memo||memo.deletedAt)return;current=structuredClone(memo);config.activeDraftId=id;config.selectedTagIds=[...memo.tagIds];revision++;history.reset(stateOf(current));renderEditor();await changeView('write');$('status').textContent='保存済み';}
function renderList(){
  const term=$('search').value.toLocaleLowerCase();const sort=$('sort').value;
  const memos=data.memos.filter(m=>!m.deletedAt&&filters.every(id=>m.tagIds.includes(id))&&(!term||[m.body,...getTags(m.tagIds).map(t=>t.name)].join('\n').toLocaleLowerCase().includes(term))).sort((a,b)=>b[sort].localeCompare(a[sort]));
  $('filterSummary').textContent=filters.length?'絞り込み（すべて一致）：'+getTags(filters).map(t=>t.name).join(' / '):`${memos.length}件`;
  $('selectMode').textContent=selecting?'選択を終了':'複数選択';$('bulk').hidden=!selecting;$('selectionCount').textContent=`${selected.size}件選択中`;
  $('bulkMerge').disabled=selected.size<2;$('bulkTags').disabled=!selected.size;$('bulkTrash').disabled=!selected.size;
  $('memoList').innerHTML=memos.length?'':'<div class="empty">'+(term||filters.length?'一致するメモがありません':'まだメモはありません。<br>「書く」から最初のメモをどうぞ。')+'</div>';
  for(const memo of memos){const card=document.createElement('article');card.className='memo-card'+(selected.has(memo.id)?' chosen':'');const b=document.createElement('button');b.className='memo-open';b.setAttribute('aria-label',(selecting?'選択 ':'編集 ')+title(memo));b.innerHTML=`<span class="memo-title">${selecting?(selected.has(memo.id)?'☑ ':'☐ '):''}${escape(title(memo))}</span><span class="memo-meta">作成 ${date(memo.createdAt)}<br>更新 ${date(memo.updatedAt)}${memo.attachmentIds.length?' · 画像 '+memo.attachmentIds.length+'枚':''}</span><span class="memo-tags">${escape(getTags(memo.tagIds).map(t=>'#'+t.name).join('  '))}</span>`;
    let longTimer,longPressed=false; b.onpointerdown=e=>{if(e.pointerType==='mouse'&&e.button!==0)return;longPressed=false;longTimer=setTimeout(()=>{longPressed=true;selecting=true;selected.add(memo.id);renderList();},550);};b.onpointerup=b.onpointercancel=b.onpointerleave=()=>clearTimeout(longTimer);b.oncontextmenu=e=>{e.preventDefault();};b.onclick=guard(async()=>{if(longPressed)return;if(selecting){selected.has(memo.id)?selected.delete(memo.id):selected.add(memo.id);renderList();}else await openMemo(memo.id);});card.append(b);
    if(!selecting){const actions=document.createElement('div');actions.className='memo-actions';const copy=document.createElement('button');copy.className='small';copy.textContent='コピー';copy.onclick=()=>copyText(memo.body);const trash=document.createElement('button');trash.className='small danger';trash.textContent='削除';trash.onclick=guard(()=>trashMemos([memo.id]));actions.append(copy,trash);card.append(actions);}$('memoList').append(card);
  }
}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast('コピーしました');}catch{const area=document.createElement('textarea');area.value=text;area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();const ok=document.execCommand('copy');area.remove();toast(ok?'コピーしました':'コピーできませんでした。本文を選択してコピーしてください。');}}
async function syncData(){const loaded=await readSnapshot();data=loaded;config=loaded.settings.find(s=>s.id==='config')||config;counter=loaded.backupState.find(s=>s.id==='counter')||counter;updateCount();}
async function trashMemos(ids){await flush();confirmDialog(`${ids.length}件をゴミ箱へ移動しますか？`,'ゴミ箱から復元できます。',guard(async()=>{const changes=data.memos.filter(m=>ids.includes(m.id)).map(m=>({...m,deletedAt:now(),updatedAt:now()}));await enqueue(()=>write({memos:changes}));await syncData();if(ids.includes(current.id)){current=blank(config.selectedTagIds);config.activeDraftId=current.id;history.reset(stateOf(current));revision++;await enqueue(()=>write({settings:[configRow()]}));renderEditor();}selected.clear();renderList();renderSettings();toast('ゴミ箱へ移動しました');}));}
async function bulkTagApply(ids,operation){await flush();const changes=data.memos.filter(m=>selected.has(m.id)).map(m=>({...m,tagIds:operation==='remove'?m.tagIds.filter(id=>!ids.includes(id)):[...new Set([...m.tagIds,...ids])],updatedAt:now()}));await enqueue(()=>write({memos:changes}));await syncData();if(selected.has(current.id)){current=structuredClone(data.memos.find(m=>m.id===current.id));config.selectedTagIds=[...current.tagIds];history.reset(stateOf(current));await enqueue(()=>write({settings:[configRow()]}));renderEditor();}renderList();toast(`${changes.length}件のタグを更新しました`);}
async function mergeSelected(){await flush();const originals=data.memos.filter(m=>selected.has(m.id)&&!m.deletedAt);if(originals.length<2)return;const merged=mergeMemos(originals);dialog('<h2>マージのプレビュー</h2><p class="muted">作成日時が古い順にまとめます。本文を調整できます。</p><textarea id="mergePreview" aria-label="統合本文"></textarea><label class="check-label"><input type="checkbox" id="moveOriginals">元メモをゴミ箱へ移動する</label><p class="muted">初期設定では元メモを残します。画像は統合メモにも複製します。</p><button id="commitMerge" class="primary">統合メモを作成</button>');$('mergePreview').value=merged.body;
  $('commitMerge').onclick=guard(async()=>{const button=$('commitMerge');button.disabled=true;try{merged.body=$('mergePreview').value;const attachments=originals.flatMap(m=>m.attachmentIds).map(id=>data.attachments.find(a=>a.id===id)).filter(Boolean).map(a=>({...a,id:uid('image'),memoId:merged.id}));merged.attachmentIds=attachments.map(a=>a.id);const changes=[merged];if($('moveOriginals').checked)changes.push(...originals.map(m=>({...m,deletedAt:now(),updatedAt:now()})));const c={...counter,createdCount:counter.createdCount+1};await enqueue(()=>write({memos:changes,attachments,backupState:[c]}));await syncData();if($('moveOriginals').checked&&originals.some(m=>m.id===current.id)){current=blank(config.selectedTagIds);config.activeDraftId=current.id;history.reset(stateOf(current));await enqueue(()=>write({settings:[configRow()]}));renderEditor();}selected.clear();closeDialog();renderList();maybeReminder();toast('統合メモを作成しました');}finally{button.disabled=false;}});
}
function renderSettings(){
  $('tagManagement').replaceChildren();
  for(const t of orderedTags()){
    const row=document.createElement('div');row.className='tag-row';const check=document.createElement('input');check.type='checkbox';check.checked=tagSelection.has(t.id);check.setAttribute('aria-label',t.name+'を選択');check.onchange=()=>check.checked?tagSelection.add(t.id):tagSelection.delete(t.id);const label=document.createElement('span');label.className='tag-name';label.textContent=t.name+(t.quick?' · クイック '+(t.quickOrder+1):'');const actions=document.createElement('div');actions.className='tag-actions';
    const action=(text,fn)=>{const b=document.createElement('button');b.textContent=text;b.onclick=guard(fn);actions.append(b);return b;};
    action('名前変更',()=>renameTag(t));action(t.quick?'クイック解除':'クイックへ',()=>updateTagObjects([{...t,quick:!t.quick,quickOrder:t.quick? t.quickOrder:data.tags.filter(t=>t.quick).length,updatedAt:now()}]));action('↑',()=>moveTag(t,'order',-1)).setAttribute('aria-label',t.name+'の表示順を上げる');action('↓',()=>moveTag(t,'order',1)).setAttribute('aria-label',t.name+'の表示順を下げる');if(t.quick){action('クイック↑',()=>moveTag(t,'quickOrder',-1));action('クイック↓',()=>moveTag(t,'quickOrder',1));}row.append(check,label,actions);$('tagManagement').append(row);
  }
  $('backupInfo').textContent=counter.confirmedAt?`前回の確認：${date(counter.confirmedAt)} / その後の新規メモ：${counter.createdCount-counter.confirmedCount}件`:`バックアップ未確認 / 新規メモ：${counter.createdCount}件`;
  $('trashList').replaceChildren();const trash=data.memos.filter(m=>m.deletedAt).sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));if(!trash.length)$('trashList').innerHTML='<p class="muted">ゴミ箱は空です</p>';
  for(const m of trash){const row=document.createElement('div');row.className='trash-row';row.innerHTML=`<p>${escape(title(m))}<br><span class="muted">削除 ${date(m.deletedAt)}</span></p>`;const restore=document.createElement('button');restore.textContent='復元';restore.onclick=guard(async()=>{await enqueue(()=>write({memos:[{...m,deletedAt:null,updatedAt:now()}]}));await syncData();renderSettings();toast('復元しました');});const remove=document.createElement('button');remove.textContent='完全削除';remove.className='danger';remove.onclick=guard(()=>confirmDialog('完全削除しますか？','このメモと添付画像は復元できません。',guard(async()=>{await enqueue(()=>write({remove:{memos:[m.id],attachments:m.attachmentIds}}));await syncData();renderSettings();toast('完全削除しました');})));row.append(restore,remove);$('trashList').append(row);}
  $('publicUrl').value='https://yuuuh26.github.io/flash-memo/';
  if(view==='settings')void storageInfo();
}
async function updateTagObjects(tags){await flush();await enqueue(()=>write({tags}));await syncData();renderSettings();renderTags();}
function renameTag(tag){dialog('<h2>タグの名前変更</h2><input id="tagName" aria-label="タグ名"><div class="dialog-actions"><button id="saveTagName" class="primary">変更</button></div>');$('tagName').value=tag.name;$('saveTagName').onclick=guard(async()=>{const name=$('tagName').value.trim();if(!name)throw new Error('タグ名を入力してください。');if(data.tags.some(t=>t.id!==tag.id&&t.name===name))throw new Error('同じ名前のタグがあります。');await updateTagObjects([{...tag,name,updatedAt:now()}]);closeDialog();});}
async function moveTag(tag,key,step){const list=[...data.tags].filter(t=>key!=='quickOrder'||t.quick).sort((a,b)=>a[key]-b[key]);const index=list.findIndex(t=>t.id===tag.id);const other=list[index+step];if(!other)return;[list[index],list[index+step]]=[other,tag];await updateTagObjects(list.map((t,i)=>({...t,[key]:i,updatedAt:now()})));}
async function bulkQuick(quick){if(!tagSelection.size)throw new Error('タグを選択してください。');const existing=data.tags.filter(t=>t.quick&&!tagSelection.has(t.id)).sort((a,b)=>a.quickOrder-b.quickOrder);const chosen=orderedTags().filter(t=>tagSelection.has(t.id));const all=quick?[...existing,...chosen]:existing;await updateTagObjects(data.tags.map(t=>({...t,quick:all.some(x=>x.id===t.id),quickOrder:Math.max(0,all.findIndex(x=>x.id===t.id)),updatedAt:now()})));}
async function deleteSelectedTags(){await flush();const ids=[...tagSelection];if(!ids.length)throw new Error('タグを選択してください。');confirmDialog(`${ids.length}件のタグを削除しますか？`,'メモ本文や画像は残ります。このタグとの関連だけを外します。',guard(async()=>{const memos=data.memos.map(m=>({...m,tagIds:m.tagIds.filter(id=>!ids.includes(id))}));const nextConfig={...config,selectedTagIds:config.selectedTagIds.filter(id=>!ids.includes(id))};await enqueue(()=>write({memos,settings:[nextConfig],remove:{tags:ids}}));await syncData();current.tagIds=current.tagIds.filter(id=>!ids.includes(id));history.reset(stateOf(current));filters=filters.filter(id=>!ids.includes(id));tagSelection.clear();renderEditor();renderSettings();toast('タグを削除しました');}));}
async function attachImages(event){
  const files=[...event.target.files];event.target.value='';if(!files.length)return;attachmentBusy=true;$('next').disabled=true;
  try{
    await flush();const newImages=[];
    for(const file of files){if(!file.type.startsWith('image/'))throw new Error('画像ファイルを選択してください。');newImages.push({id:uid('image'),memoId:current.id,type:file.type,blob:file,fileName:file.name,createdAt:now()});}
    await enqueue(async()=>{
      const memo=structuredClone(current);memo.attachmentIds.push(...newImages.map(a=>a.id));memo.updatedAt=now();const isNew=!data.memos.some(m=>m.id===memo.id);const c={...counter,createdCount:counter.createdCount+(isNew?1:0)};
      await write({memos:[memo],attachments:newImages,backupState:[c],settings:[configRow()]});data.attachments.push(...newImages);data.memos=data.memos.filter(m=>m.id!==memo.id).concat(memo);counter=c;current.attachmentIds=memo.attachmentIds;current.updatedAt=memo.updatedAt;revision++;history.push(stateOf(current));renderImages();historyButtons();updateCount();$('status').textContent='保存済み';
    });
    await flush();
  }finally{attachmentBusy=false;$('next').disabled=false;}
}
async function canonicalSnapshot(){const snapshot=await readSnapshot();const refs=new Set(snapshot.memos.flatMap(m=>m.attachmentIds));snapshot.attachments=snapshot.attachments.filter(a=>refs.has(a.id));snapshot.settings=snapshot.settings.map(s=>s.id==='config'?{...s,activeDraftId:snapshot.memos.some(m=>m.id===s.activeDraftId)?s.activeDraftId:null}:s);return snapshot;}
async function doExport(){
  await flush();const snapshot=await canonicalSnapshot();const json=await exportData(snapshot);const count=snapshot.backupState.find(c=>c.id==='counter').createdCount;pendingExport={count,exportedAt:json.exportedAt};$('exportResult').textContent='✓ バックアップファイルを作成しました';
  const filename=download(json);$('exportResult').innerHTML=`<p>✓ バックアップファイルを作成しました<br>✓ ダウンロードを開始しました</p><p class="muted">${escape(filename)}<br>ダウンロード一覧でファイルを確認してください。</p><button id="confirmBackup" class="primary">確認できた</button>`;
  $('confirmBackup').onclick=guard(async()=>{const c={...counter,confirmedCount:Math.max(counter.confirmedCount,pendingExport.count),confirmedAt:now(),remindedCount:Math.max(counter.remindedCount,pendingExport.count)};await enqueue(()=>write({backupState:[c]}));counter=c;pendingExport=null;$('exportResult').textContent='✓ バックアップ確認済み';$('reminder').hidden=true;renderSettings();toast('バックアップを確認済みにしました');});
}
async function importFile(event){const file=event.target.files[0];event.target.value='';if(!file)return;await flush();let incoming;try{incoming=decodeBackup(JSON.parse(await file.text()));}catch(e){$('importResult').textContent='インポート失敗：'+e.message;throw e;}const mode=$('importMode').value;dialog(`<h2>インポートを確認</h2><p>メモ：${incoming.memos.length}件<br>タグ：${incoming.tags.length}件<br>画像：${incoming.attachments.length}件</p><p>${mode==='replace'?'現在の全データを置き換えます。':'現在のデータを残して追加します。同じIDは現在のデータを優先します。'}</p>${mode==='replace'?'<button id="beforeBackup">置換前バックアップを作成</button><label class="check-label"><input id="beforeConfirm" type="checkbox">ダウンロード一覧で置換前バックアップを確認した</label>':''}<button id="commitImport" class="primary" ${mode==='replace'?'disabled':''}>インポートする</button>`);
  let beforeReady=false;
  if(mode==='replace'){
    $('beforeBackup').onclick=guard(async()=>{const snapshot=await canonicalSnapshot();download(await exportData(snapshot),'flash-memo-before-import');beforeReady=true;toast('置換前バックアップのダウンロードを開始しました');$('commitImport').disabled=!$('beforeConfirm').checked;});$('beforeConfirm').onchange=()=>{$('commitImport').disabled=!beforeReady||!$('beforeConfirm').checked;};
  }
  $('commitImport').onclick=guard(async()=>{const button=$('commitImport');button.disabled=true;try{const existing=await canonicalSnapshot();const result=mode==='replace'?incoming:combineBackup(existing,incoming);await enqueue(()=>write(result,mode==='replace'));await syncData();const draft=data.memos.find(m=>m.id===config.activeDraftId&&!m.deletedAt);current=draft?structuredClone(draft):blank(config.selectedTagIds);config.activeDraftId=current.id;revision++;history.reset(stateOf(current));selected.clear();tagSelection.clear();filters=[];pendingExport=null;$('exportResult').textContent='';$('reminder').hidden=true;renderEditor();renderSettings();closeDialog();$('importResult').textContent=`インポート完了 · 現在のメモ：${data.memos.length}件 / タグ：${data.tags.length}件 / 画像：${data.attachments.length}件`;toast('インポート完了');}finally{button.disabled=false;}});
}
async function storageInfo(){
  const refresh=++storageRefresh;
  storageAbort?.abort();storageAbort=new AbortController();const signal=storageAbort.signal;
  $('appStorage').textContent='このアプリの使用容量（概算）：計算中…';
  $('appStorageDetails').textContent='';
  $('hostStorage').textContent='同じホスト全体の使用容量（ブラウザ推計）：取得中…';
  $('hostStorageScope').textContent=`この端末・このブラウザの ${window.location.origin} 全体。他のアプリのIndexedDBやオフライン用データも含みます。`;
  const [app,host,persisted]=await Promise.allSettled([
    appStorageUsage(globalThis.caches,new URL('../',import.meta.url).href,signal),
    Promise.resolve().then(()=>navigator.storage?.estimate?.()),
    Promise.resolve().then(()=>navigator.storage?.persisted?.())
  ]);
  if(refresh!==storageRefresh)return;
  $('persistence').textContent='永続ストレージ：'+(persisted.status==='rejected'?'未確認':persisted.value===undefined?'非対応':persisted.value?'有効':'未許可');
  if(app.status==='fulfilled'){
    const {database,cache,total}=app.value;
    $('appStorage').textContent=`このアプリの使用容量（概算）：${total===null?'一部取得できません':'約'+formatBytes(total)}`;
    const part=value=>value===null?'取得できません':'約'+formatBytes(value);
    $('appStorageDetails').textContent=`保存データ：${part(database)} / オフライン用ファイル：${part(cache)}`;
  }else $('appStorage').textContent='このアプリの使用容量（概算）：取得できません';
  const usage=host.status==='fulfilled'?host.value?.usage:undefined;
  $('hostStorage').textContent=`同じホスト全体の使用容量（ブラウザ推計）：${Number.isFinite(usage)&&usage>=0?'約'+formatBytes(usage):'取得できません'}`;
}
function bind(){
  $('refreshStorage').onclick=()=>storageInfo();
  $('body').oninput=()=>{if(!writer)return;current.body=$('body').value;resized();markChanged();};
  $('body').onblur=()=>{if(writer)flush().catch(failure);};
  for(const button of document.querySelectorAll('nav button'))button.onclick=guard(()=>changeView(button.dataset.view));
  document.querySelector('.brand').onclick=guard(e=>{e.preventDefault();return changeView('write');});
  $('next').onpointerdown=e=>e.preventDefault();$('next').onclick=guard(nextMemo);
  for(const id of ['undo','redo','copyCurrent'])$(id).onpointerdown=e=>e.preventDefault();
  $('allTags').onclick=guard(()=>tagDialog('メモのタグ',current.tagIds,async ids=>{current.tagIds=ids;config.selectedTagIds=[...ids];markChanged();renderTags();await flush();}));
  $('undo').onclick=guard(()=>{Object.assign(current,history.undo());current.tagIds=current.tagIds.filter(id=>data.tags.some(t=>t.id===id));config.selectedTagIds=[...current.tagIds];markChanged(false);renderEditor();});
  $('redo').onclick=guard(()=>{Object.assign(current,history.redo());config.selectedTagIds=[...current.tagIds];markChanged(false);renderEditor();});
  $('copyCurrent').onclick=()=>copyText($('body').value);
  $('imageInput').onchange=$('cameraInput').onchange=guard(attachImages);
  $('search').oninput=renderList;$('sort').onchange=renderList;
  $('filterTags').onclick=guard(()=>tagDialog('タグで絞り込み',filters,ids=>{filters=ids;renderList();},{extra:'<p class="muted">選んだタグすべてを含むメモを表示します。未選択で解除します。</p>'}));
  $('selectMode').onclick=()=>{selecting=!selecting;selected.clear();renderList();};
  $('bulkTrash').onclick=guard(()=>trashMemos([...selected]));$('bulkMerge').onclick=guard(mergeSelected);
  $('bulkTags').onclick=guard(()=>tagDialog('選択したメモのタグ編集',[],bulkTagApply,{mode:'bulk',extra:'<select id="tagOperation" aria-label="一括編集方法"><option value="add">タグを追加する</option><option value="remove">タグを削除する</option></select>'}));
  $('newTagForm').onsubmit=guard(async e=>{e.preventDefault();const name=$('newTag').value.trim();if(!name)throw new Error('タグ名を入力してください。');if(data.tags.some(t=>t.name===name))throw new Error('同じ名前のタグがあります。');const tag={id:uid('tag'),name,quick:true,quickOrder:data.tags.filter(t=>t.quick).length,order:data.tags.length,createdAt:now(),updatedAt:now()};await updateTagObjects([tag]);$('newTag').value='';toast('タグを追加しました');});
  $('quickAdd').onclick=guard(()=>bulkQuick(true));$('quickRemove').onclick=guard(()=>bulkQuick(false));$('deleteTags').onclick=guard(deleteSelectedTags);
  $('export').onclick=guard(doExport);$('importInput').onchange=guard(importFile);
  $('persist').onclick=guard(async()=>{if(!navigator.storage?.persist){toast('このブラウザは非対応です');return;}const allowed=await navigator.storage.persist();await storageInfo();toast(allowed?'永続ストレージが有効になりました':'今回は許可されませんでした。引き続きバックアップをご利用ください。');});
  $('copyUrl').onclick=()=>copyText($('publicUrl').value);$('copyRepo').onclick=()=>copyText('https://github.com/yuuuh26/flash-memo');
  $('backupNow').onclick=guard(async()=>{$('reminder').hidden=true;await changeView('settings');await doExport();});$('backupLater').onclick=guard(postponeReminder);
  $('closeDialog').onclick=closeDialog;
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&ready&&writer)flush().catch(failure);});
  window.addEventListener('pagehide',()=>{if(ready&&writer)flush().catch(failure);});
  window.addEventListener('beforeunload',e=>{if(ready&&writer&&$('status').textContent!=='保存済み'&&hasContent(current)){e.preventDefault();e.returnValue='';}});
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installEvent=e;$('install').hidden=false;});$('install').onclick=async()=>{if(installEvent){await installEvent.prompt();await installEvent.userChoice;installEvent=null;$('install').hidden=true;}};
  window.addEventListener('appinstalled',()=>{$('install').hidden=true;toast('ホーム画面に追加されました');});
}
async function start(){
  try{
    if(navigator.locks){let resolveLock;const locked=new Promise(resolve=>resolveLock=resolve);navigator.locks.request('flash-memo-writer',{ifAvailable:true},async lock=>{writer=Boolean(lock);resolveLock();if(lock)await new Promise(()=>{});});await locked;}else writer=true;
    await openDB();data=await readSnapshot();config=data.settings.find(s=>s.id==='config')||{id:'config',selectedTagIds:[],activeDraftId:null};counter=data.backupState.find(s=>s.id==='counter')||{id:'counter',createdCount:0,confirmedCount:0,remindedCount:0,confirmedAt:null};
    const draft=data.memos.find(m=>m.id===config.activeDraftId&&!m.deletedAt);current=draft?structuredClone(draft):blank(config.selectedTagIds);config.activeDraftId=current.id;history=new History(stateOf(current));
    if(writer)await write({settings:[configRow()],backupState:[counter]});
    bind();ready=true;renderEditor();updateCount();$('status').textContent=hasContent(current)?'保存済み':'入力すると自動保存';
    if(!writer){$('fatal').hidden=false;$('fatal').textContent='別のFLASH MEMOが開いています。データを守るため、この画面は閲覧専用です。そちらを閉じてから再読み込みしてください。';$('body').readOnly=true;$('next').disabled=true;}
    else $('body').focus({preventScroll:true});
    if('serviceWorker'in navigator){try{await navigator.serviceWorker.register('./sw.js',{scope:'./'});const registration=await navigator.serviceWorker.ready;$('offline').textContent=registration.active?'オフライン用データ：準備済み':'オフライン用データ：準備中';}catch(error){$('offline').textContent='オフライン用データ：準備できませんでした。オンラインで再度開いてください。';}}
  }catch(error){$('fatal').hidden=false;$('fatal').textContent='起動できませんでした：'+error.message;$('status').textContent='保存できません';$('body').readOnly=true;$('next').disabled=true;}
}
start();
