/* tabs (mockups) — tolerant of missing prototype */
const tabs=[...document.querySelectorAll('.tab')],panels=[...document.querySelectorAll('[data-panel]')];
function showScreen(name){if(!panels.some(p=>p.dataset.panel===name))return;tabs.forEach(x=>x.classList.toggle('on',x.dataset.screen===name));panels.forEach(x=>x.classList.toggle('on',x.dataset.panel===name));}
tabs.forEach(x=>x.addEventListener('click',()=>showScreen(x.dataset.screen)));
/* toast */
let toastTimer;function toast(msg){const t=document.getElementById('toast');if(!t)return;t.textContent=msg;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2400)}
/* filters: each .filters group filters [data-type] rows inside data-target (or the next sibling). data-type may hold several space-separated types */
document.querySelectorAll('.filters').forEach(g=>{const bs=[...g.querySelectorAll('.filter,.pill')],tgt=g.dataset.target?document.querySelector(g.dataset.target):g.nextElementSibling;if(!tgt)return;bs.forEach(b=>b.addEventListener('click',()=>{bs.forEach(x=>x.classList.remove('on'));b.classList.add('on');const f=b.dataset.filter;tgt.querySelectorAll('[data-type]').forEach(r=>{r.hidden=f!=='all'&&!(r.dataset.type||'').split(/\s+/).includes(f)})}))});
/* nav highlight: last section whose top has passed the reading line (sections are far taller than the viewport,
   so an IntersectionObserver leaves the mark stale as often as not) */
const nav=[...document.querySelectorAll('.nav a')],secs=nav.map(a=>document.querySelector(a.getAttribute('href')));
let navTick=0;
function spy(){navTick=0;const line=Math.max(96,innerHeight*.22);let cur=0;
 secs.forEach((s,j)=>{if(s&&s.getBoundingClientRect().top<=line)cur=j});
 nav.forEach((a,j)=>a.classList.toggle('on',j===cur));
 const a=nav[cur],box=a&&a.parentNode;
 if(a&&box&&box.scrollWidth>box.clientWidth+2&&(a.offsetLeft<box.scrollLeft||a.offsetLeft+a.offsetWidth>box.scrollLeft+box.clientWidth))
  box.scrollTo({left:a.offsetLeft-box.clientWidth/2+a.offsetWidth/2,behavior:'smooth'});}
if(nav.length){addEventListener('scroll',()=>navTick||(navTick=requestAnimationFrame(spy)),{passive:true});addEventListener('resize',spy);spy()}
/* QR art (check-in panel) */
const qr=document.getElementById('qr');if(qr&&!qr.children.length){['1111111001011','1000001010010','1011101011111','1011101000101','1011101011101','1000001001001','1111111010101','0001000011110','1110111010011','0011100011100','1110011110111','1001010010001','1111111011111'].join('').split('').forEach(v=>{const i=document.createElement('i');if(v==='1')i.className='on';qr.appendChild(i)})}
/* countdown (check-in panel) */
let seconds=582;const cd=document.getElementById('countdown');if(cd)setInterval(()=>{if(seconds<=0)return;seconds--;cd.textContent=String(Math.floor(seconds/60)).padStart(2,'0')+':'+String(seconds%60).padStart(2,'0')},1000);
/* code blocks + tables: measured lazily, because anything inside a closed <details> has no size yet */
function enhance(root){
 root.querySelectorAll('.code:not([data-done]),.ddl:not([data-done])').forEach(c=>{const p=c.querySelector('pre');
  if(!p||!p.clientHeight)return;c.dataset.done=1;if(p.scrollHeight<=p.clientHeight+4)return;
  c.classList.add('clipped');const b=document.createElement('button');b.type='button';b.className='expand';b.textContent='ขยาย';
  b.addEventListener('click',()=>{const o=c.classList.toggle('open');b.textContent=o?'ย่อ':'ขยาย'});c.appendChild(b)});
 root.querySelectorAll('.md .tableWrap:not([data-done])').forEach(w=>{
  const t=w.querySelector('table');if(!t||!w.clientWidth)return;w.dataset.done=1;
  const wide=w.scrollWidth>w.clientWidth+4,tall=t.scrollHeight>900,tools=document.createElement('div');
  if(!wide&&!tall)return;
  tools.className='tblTools';
  if(tall){w.classList.add('clip');
   const n=t.tBodies[0]?t.tBodies[0].rows.length:0,more=n?'แสดงทั้งหมด ('+n+' แถว)':'แสดงทั้งหมด',b=document.createElement('button');
   b.type='button';b.className='moreBtn';b.textContent=more;
   b.addEventListener('click',()=>{b.textContent=w.classList.toggle('clip')?more:'ย่อตาราง';if(!w.classList.contains('clip'))w.scrollTop=0});
   tools.appendChild(b)}
  if(wide)tools.insertAdjacentHTML('beforeend','<span>↔ เลื่อนดูคอลัมน์ที่เหลือ</span>');
  w.after(tools)});
}
enhance(document);
document.addEventListener('toggle',e=>{if(e.target.open)enhance(e.target)},true);
/* sub-nav folds away on phones; everything prints expanded */
if(innerWidth<800)document.querySelectorAll('details.secnav').forEach(d=>d.open=false);
addEventListener('beforeprint',()=>document.querySelectorAll('details:not([open])').forEach(d=>{d.dataset.shut=1;d.open=true}));
addEventListener('afterprint',()=>document.querySelectorAll('details[data-shut]').forEach(d=>{d.open=false;delete d.dataset.shut}));
/* folder trees: mute the guide lines */
document.querySelectorAll('pre.tree').forEach(t=>{if(t.querySelector('.g'))return;t.innerHTML=t.innerHTML.replace(/^([│├└─ ]+)/gm,'<span class="g">$1</span>')});
