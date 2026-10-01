export const VERSION='1.0.0';
export const uid=(prefix)=>`${prefix}_${crypto.randomUUID()}`;
export const now=()=>new Date().toISOString();
export const blank=(tagIds=[])=>({id:uid('memo'),body:'',createdAt:now(),updatedAt:now(),tagIds:[...tagIds],attachmentIds:[],mergedFromIds:[],deletedAt:null});
export const hasContent=m=>Boolean(m.body.trim()||m.attachmentIds.length);
export const title=m=>m.body.trim().split('\n')[0].slice(0,90)||'画像メモ';
export const date=s=>new Date(s).toLocaleString('ja-JP',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
export function mergeMemos(memos){
  const ordered=[...memos].sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  return {...blank([...new Set(ordered.flatMap(m=>m.tagIds))]),body:ordered.map(m=>`${date(m.createdAt)}\n${m.body}`).join('\n\n────────\n\n'),mergedAt:now(),mergedFromIds:ordered.map(m=>m.id)};
}
export class History{
  constructor(value){this.reset(value);}
  reset(value){this.items=[structuredClone(value)];this.index=0;}
  push(value){const v=structuredClone(value);if(JSON.stringify(this.items[this.index])===JSON.stringify(v))return;this.items=this.items.slice(0,this.index+1);this.items.push(v);if(this.items.length>51)this.items.shift();this.index=this.items.length-1;}
  undo(){if(this.index>0)this.index--;return structuredClone(this.items[this.index]);}
  redo(){if(this.index<this.items.length-1)this.index++;return structuredClone(this.items[this.index]);}
}
