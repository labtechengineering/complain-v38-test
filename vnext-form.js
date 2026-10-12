/* Complain VNext multi-issue form. Requires migrations 13..20.
   Creates one legacy-compatible parent plus all routing in one DB transaction.
   Media is uploaded afterwards and may require retry if network fails. */
(()=>{'use strict';
 if(new URLSearchParams(location.search).has('edit'))return;
 const $=id=>document.getElementById(id);
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
 const problems=[];let seq=0,receivers=[],createdId='',requestId='',busy=false;
 const err=e=>e?.message||String(e);
 function status(msg,bad=false){const el=$('vnStatus');el.textContent=msg;el.style.color=bad?'#b91c1c':'#126332';}
 function rpc(name,args){return QA.client.rpc(name,args).then(({data,error})=>{if(error)throw error;return data;});}
 const style=document.createElement('style');style.textContent=`
 .vn-card{border:1px solid #d9e2ea;border-radius:11px;background:#fff;padding:15px;margin:12px 0}
 .vn-row{display:flex;gap:12px;flex-wrap:wrap}.vn-row>*{flex:1;min-width:180px}
 .vn-checks{display:flex;flex-wrap:wrap;gap:9px}.vn-checks label{border:1px solid #dae1ea;display:flex;align-items:center;gap:7px;padding:8px 10px;border-radius:8px;font-weight:400}
 .vn-checks input{width:auto}.vn-card textarea{min-height:82px}.vn-btn{border:1px solid #bdcad6;border-radius:8px;padding:10px 13px;cursor:pointer;background:#f1f5f9}
 .vn-files{font-size:12px;color:#526276}.vn-note{font-size:13px;color:#5b6675}
 .vn-source-buttons{display:flex;gap:12px;justify-content:center;margin:8px 0 20px;flex-wrap:wrap}
 .vn-source-choice{min-width:180px;flex:0 1 290px;border:1px solid #6289ee;background:#fff;color:#1f2937;border-radius:8px;padding:12px 14px;cursor:pointer;font:inherit}
 .vn-source-choice[aria-pressed="true"]{background:#eaf1ff;border-color:#275cdd;box-shadow:inset 0 0 0 1px #275cdd;font-weight:600}
 .vn-main-meta{display:grid;grid-template-columns:1fr 1fr;gap:12px}
 .vn-main-meta label{display:flex;flex-direction:column;gap:5px}.vn-main-meta .vn-remark{grid-column:1/-1}
 .vn-main-meta textarea{min-height:72px}
 @media(max-width:650px){.vn-main-meta{grid-template-columns:1fr}.vn-source-choice{min-width:125px;flex:1}}
 `;document.head.append(style);
 function create(){return {id:++seq,images:[],video:[],category:'',description:'',departments:[]};}
 problems.push(create());
 const oldProblem=$('problemDetail')?.closest('.card');if(!oldProblem)return;
 const panel=document.createElement('section');panel.className='card';panel.id='vnPanel';
 panel.innerHTML=`<div class="section-title">2. รายละเอียดงาน / ปัญหาที่พบ</div>
 <div id="vnProblems"></div><button type="button" class="vn-btn" id="vnAdd">+ เพิ่มปัญหา</button>
 <p id="vnStatus" role="status" aria-live="polite"></p>`;
 oldProblem.before(panel);oldProblem.style.display='none';$('toDepartment').closest('.field').style.display='none';$('toDepartment').required=false;
 // Put shared job fields inside section 1; issue-specific fields remain in section 2.
 // Hide the two read-only identity fields only in the new request form.
 // supabase-api.js / QA.applyPermissions() still fills these inputs from the logged-in profile.
 // Do not remove inputs or change their IDs, so legacy validation, PDF and metadata remain intact.
 for(const fieldId of ['issuerName','fromDepartment']){
   const input=$(fieldId);
   if(input){const field=input.closest('.field');if(field)field.style.display='none';}
 }
 const mainCard=$('serialNo').closest('.card');
 const mainGrid=mainCard.querySelector('.grid');
 const sourceWrap=document.createElement('div');
 sourceWrap.innerHTML=`<div class="vn-source-buttons" role="group" aria-label="ประเภทงาน">
 <button type="button" class="vn-source-choice" data-source="PRODUCTION" aria-pressed="true">Production</button>
 <button type="button" class="vn-source-choice" data-source="AFTERSALES" aria-pressed="false">Aftersales</button></div>
 <select id="vnSource" hidden aria-label="ประเภทงาน"><option value="PRODUCTION">Production</option><option value="AFTERSALES">Aftersales</option></select>`;
 mainCard.insertBefore(sourceWrap,mainGrid);
 sourceWrap.querySelectorAll('[data-source]').forEach(button=>button.addEventListener('click',()=>{
   $('vnSource').value=button.dataset.source;
   sourceWrap.querySelectorAll('[data-source]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
 }));
 const meta=document.createElement('div');meta.className='vn-main-meta';
 meta.innerHTML=`<label>Customer Name<input id="vnCustomer" maxlength="200"></label>
 <label>Country<input id="vnCountry" maxlength="120"></label>
 <label class="vn-remark">Remark<textarea id="vnRemark" maxlength="20000"></textarea></label>`;
 mainGrid.after(meta);
 $('category').required=false;$('problemDetail').required=false;
 const oldImages=$('imageInput').closest('.card');oldImages.style.display='none';
 const baseSubmit=$('submitBtn');baseSubmit.textContent='แจ้งงาน';
 function save(){for(const el of $('vnProblems').querySelectorAll('[data-issue]')){const i=problems.find(p=>p.id===+el.dataset.issue);if(!i)continue;i.category=el.querySelector('.vn-category').value;i.description=el.querySelector('.vn-detail').value;i.departments=[...el.querySelectorAll('.vn-dept:checked')].map(c=>c.value);}}
 function render(){const host=$('vnProblems');host.replaceChildren();problems.forEach((p,i)=>{
  const box=document.createElement('article');box.className='vn-card';box.dataset.issue=p.id;
  const opt=[...$('category').options].filter(x=>x.value).map(x=>`<option value="${esc(x.value)}">${esc(x.textContent)}</option>`).join('');
  box.innerHTML=`<div class="vn-row" style="align-items:center"><h3>ปัญหา ${i+1}</h3>${problems.length>1?'<button type="button" class="vn-btn vn-remove">ลบปัญหานี้</button>':''}</div>
  <label>ประเภทปัญหา *<select class="vn-category" required><option value="">-- เลือก Category --</option>${opt}</select></label>
  <label>รายละเอียดปัญหา *<textarea class="vn-detail" maxlength="20000" required></textarea></label>
  <strong>ฝ่ายรับเรื่อง * (เลือกได้มากกว่า 1)</strong><div class="vn-checks">${receivers.filter(x=>x.enabled).map(x=>`<label><input class="vn-dept" type="checkbox" value="${esc(x.code)}">${esc(x.code)}</label>`).join('')}</div>
  <div class="vn-row"><label>ภาพประกอบ (ไม่เกิน 5 ภาพ)<input type="file" accept="image/jpeg,image/png,image/webp" class="vn-images" multiple></label><label>วิดีโอ (ไม่เกิน 1 คลิป)<input type="file" accept="video/mp4,video/webm" class="vn-video"></label></div>
  <p class="vn-files"></p>`;
  box.querySelector('.vn-category').value=p.category;box.querySelector('.vn-detail').value=p.description;
  for(const ch of box.querySelectorAll('.vn-dept'))ch.checked=p.departments.includes(ch.value);
  box.querySelector('.vn-images').onchange=e=>{const files=[...e.target.files];if(files.length>5||files.some(f=>!['image/jpeg','image/png','image/webp'].includes(f.type)||f.size>5242880)){status('รูปภาพสูงสุด 5 รูป รูปละไม่เกิน 5 MB (JPG, PNG, WebP)',true);e.target.value='';return;}p.images=files;updateFiles();};
  box.querySelector('.vn-video').onchange=e=>{const files=[...e.target.files];if(files.length>1||files.some(f=>!['video/mp4','video/webm'].includes(f.type)||f.size>52428800)){status('วิดีโอสูงสุด 1 คลิป ขนาดไม่เกิน 50 MB (MP4 หรือ WebM)',true);e.target.value='';return;}p.video=files;updateFiles();};
  function updateFiles(){box.querySelector('.vn-files').textContent=`${p.images.length} รูป · ${p.video.length} วิดีโอ`;}
  updateFiles();box.querySelector('.vn-remove')?.addEventListener('click',()=>{save();problems.splice(problems.indexOf(p),1);render();});host.append(box);
 });}
 $('vnAdd').onclick=()=>{if(problems.length>=20){status('สูงสุด 20 ปัญหา',true);return;}save();problems.push(create());render();};
 function collect(){save();if(!receivers.some(x=>x.enabled))throw new Error('ยังไม่ได้กำหนดฝ่ายรับเรื่องใน Settings');
 const issues=problems.map((p,i)=>{if(!p.category||!p.description.trim()||p.departments.length===0)throw new Error(`ปัญหา ${i+1}: กรอกประเภท รายละเอียด และฝ่ายรับเรื่องให้ครบ`);
 return {category_code:p.category,description:p.description.trim(),departments:p.departments};});
 const header={serialNo:$('serialNo').value.trim(),impact:$('impact').value.trim(),location:$('location').value.trim(),downtimeMin:$('downtimeMin').value||'',
 customerName:$('vnCustomer').value.trim(),country:$('vnCountry').value.trim(),remark:$('vnRemark').value.trim(),sourceType:$('vnSource').value};
 return {issues,header};}
 async function uploadMedia(jobId){for(let n=0;n<problems.length;n++){
 const issue=problems[n];for(const file of [...issue.images,...issue.video]){
  const kind=file.type.startsWith('image/')?'IMAGE':'VIDEO';
  const key=`${jobId}-${n+1}-${file.name}-${file.size}`;
  if(issue.uploaded?.has(key))continue;
  const ext=file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin';
  const path=`${QA.profile.user_id}/${crypto.randomUUID()}.${ext}`;
  const {error:upError}=await QA.client.storage.from('qa-vnext-media').upload(path,file,{contentType:file.type,upsert:false});
  if(upError)throw new Error(`ใบงาน ${jobId} บันทึกแล้ว แต่ไฟล์ ${file.name} ยังไม่สำเร็จ: ${upError.message}`);
  await rpc('qa_vnext_register_attachment',{p_job_id:jobId,p_scope:'ISSUE',p_issue_number:n+1,p_assignment_id:null,p_kind:kind,p_path:path,p_mime_type:file.type,p_size_bytes:file.size});
  if(!issue.uploaded)issue.uploaded=new Set();issue.uploaded.add(key);
 }} }

 async function loadScreenshot(){if(window.html2canvas)return;
  await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('ไม่สามารถโหลดตัวสร้างภาพ LINE'));document.head.append(s);});}
 async function makeJobImage(jobId,dept){await loadScreenshot();
  const matching=problems.map((p,i)=>({p,i})).filter(({p})=>p.departments.includes(dept));
  const host=document.createElement('div');host.style.cssText='position:absolute;left:0;top:0;width:960px;background:white;padding:34px;font:18px Arial,Tahoma,sans-serif;z-index:999999;color:#172337';
  const heading=document.createElement('div');heading.innerHTML='<h1 style="font-size:30px;margin:0">Complain &amp; Action Tracking</h1><p style="font-size:18px;margin:8px 0 18px">ใบแจ้งงาน: <b>'+esc(jobId)+'</b> &nbsp; ฝ่ายรับเรื่อง: <b>'+esc(dept)+'</b></p>';
  host.append(heading);
  const hdr=document.createElement('div');hdr.style.cssText='padding:15px;border:1px solid #d1d5db;border-radius:9px;margin-bottom:18px';
  hdr.innerHTML='<b>1. ข้อมูลการแจ้งเรื่อง</b><p>ประเภท: '+esc($('vnSource').value)+' &nbsp; Serial: '+esc($('serialNo').value)+'<br>Customer: '+esc($('vnCustomer').value)+' &nbsp; Country: '+esc($('vnCountry').value)+'<br>Remark: '+esc($('vnRemark').value)+'</p>';host.append(hdr);
  for(const {p,i} of matching){const block=document.createElement('section');block.style.cssText='padding:15px;border:1px solid #d1d5db;border-radius:9px;margin-bottom:18px;page-break-inside:avoid';
   block.innerHTML='<b>2. รายละเอียดปัญหา '+(i+1)+'</b><p><b>Category:</b> '+esc(p.category)+'</p><p style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(p.description)+'</p>';
   const row=document.createElement('div');row.style.cssText='display:flex;gap:10px;flex-wrap:wrap';
   for(const f of p.images){const img=document.createElement('img');img.src=URL.createObjectURL(f);img.style.cssText='width:170px;height:125px;object-fit:contain;border:1px solid #d1d5db';row.append(img);}
   if(p.video.length){const note=document.createElement('div');note.textContent='วิดีโอแนบ: '+p.video.map(v=>v.name).join(', ');row.append(note);}
   block.append(row);host.append(block);
  }
  document.body.append(host);
  try{const imgs=[...host.querySelectorAll('img')];await Promise.all(imgs.map(img=>new Promise(r=>{if(img.complete)r();else{img.onload=r;img.onerror=r;}})));
   const c=await html2canvas(host,{scale:1,backgroundColor:'#fff',useCORS:true,logging:false});return c.toDataURL('image/png').split(',')[1];
  }finally{for(const img of host.querySelectorAll('img'))URL.revokeObjectURL(img.src);host.remove();}}
 async function notifyLine(jobId){const depts=[...new Set(problems.flatMap(p=>p.departments))];const failures=[];
  for(const dept of depts){try{
    status('กำลังสร้างภาพใบงานและส่ง LINE ให้ฝ่าย '+dept+'...');
    const png=await makeJobImage(jobId,dept);
    const {data,error}=await QA.client.functions.invoke('vnext-new-job-line',{body:{job_id:jobId,department_code:dept,png_base64:png}});
    if(error)throw error;if(data?.error)throw new Error(data.error);if(data?.skipped)throw new Error(data.reason||'LINE group not configured');
  }catch(e){failures.push(dept+': '+err(e));}}
  if(failures.length)throw new Error('ใบงานบันทึกและแนบไฟล์แล้ว แต่ LINE ยังส่งไม่ครบ: '+failures.join(' | '));}
 async function submit(e){e.preventDefault();e.stopImmediatePropagation();if(busy)return;
 if(new URLSearchParams(location.search).has('edit')){status('ใบงานเก่าใช้การแก้ไขเดิม กรุณากลับไปหน้าใบงาน',true);return;}
 busy=true;baseSubmit.disabled=true;try{
  let jobId=createdId;
  if(!jobId){const {header,issues}=collect();requestId=requestId||crypto.randomUUID();
   status('กำลังบันทึกใบงานและส่งเข้าทุกแผนก...');
   const result=await rpc('qa_vnext_create_job',{p_data:header,p_issues:issues,p_files:[],p_request_id:requestId});
   jobId=String(result?.jobId||'');if(!jobId)throw new Error('ไม่พบหมายเลขงานที่บันทึก');createdId=jobId;
   sessionStorage.setItem('qa-vnext-latest',jobId);
  }
  status(`สร้างใบงาน ${jobId} แล้ว กำลังบันทึกไฟล์แนบ...`);
  await uploadMedia(jobId);
  await notifyLine(jobId);
  status('บันทึกสำเร็จ '+jobId+' กำลังเปิดใบงาน');
  location.replace('vnext-job.html?id='+encodeURIComponent(jobId));
 }catch(ex){status(err(ex)+(createdId?' — ระบบเก็บเลขงานไว้แล้ว อย่ากดสร้างซ้ำ กดปุ่มเดิมเพื่ออัปโหลดไฟล์อีกครั้ง':''),true);}
 finally{busy=false;baseSubmit.disabled=false;}}
 $('jobForm').addEventListener('submit',submit,true);
 async function init(){try{for(let i=0;i<140&&!QA.profile;i++)await new Promise(r=>setTimeout(r,100));if(!QA.profile)throw new Error('Login ไม่พร้อม');
 receivers=await rpc('qa_vnext_receivers',{});if(!Array.isArray(receivers))throw new Error('Receiving Settings ไม่พร้อม');
 render();}catch(e){status('VNext ใช้งานไม่ได้: '+err(e),true);baseSubmit.disabled=true;}}
 // The legacy category options load asynchronously.
 const o=new MutationObserver(()=>{save();render();});o.observe($('category'),{childList:true});
 init();
})();
