(()=>{'use strict';const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const jobId=new URLSearchParams(location.search).get('id')||new URLSearchParams(location.search).get('job');let detail,media=[];
const setNote=(s,bad=false)=>{$('feedback').textContent=s;$('feedback').style.color=bad?'#b91c1c':'#166534';};
async function rpc(name,args){const {data,error}=await QA.client.rpc(name,args);if(error)throw error;return data;}
function label(s){return ({OPEN:'รอรับงาน',IN_PROGRESS:'กำลังดำเนินงาน',WAITING_REVIEW:'รอตรวจสอบ',CLOSED:'สำเร็จ',REWORK:'กำลังดำเนินงาน',CANCELLED:'ยกเลิก'})[s]||s;}
async function getUrl(path,download=false){const opts=download?{download:true}:undefined;const {data,error}=await QA.client.storage.from('qa-vnext-media').createSignedUrl(path,900,opts);if(error)throw error;return data.signedUrl;}
async function mediaFor(issueIds,assignmentId){const permitted=media.filter(m=>(m.scope==='ISSUE'&&issueIds.includes(m.issue_id))||(m.scope==='ASSIGNMENT'&&m.assignment_id===assignmentId));
 if(!permitted.length)return '<p class="muted">ไม่มีไฟล์แนบ</p>';
 const cards=await Promise.all(permitted.map(async m=>{try{const view=await getUrl(m.storage_path),download=await getUrl(m.storage_path,true);
 const preview=m.kind==='IMAGE'?`<img src="${esc(view)}" alt="ภาพประกอบ">`:`<video controls preload="metadata" src="${esc(view)}"></video>`;
 return `<div class="media-item">${preview}<a href="${esc(download)}" download target="_blank" rel="noopener">ดาวน์โหลด ${m.kind==='IMAGE'?'ภาพ':'วิดีโอ'}</a></div>`;
 }catch(e){return `<div class="media-item">ไม่สามารถสร้างลิงก์ไฟล์ได้: ${esc(e.message)}</div>`;}}));return `<div class="media">${cards.join('')}</div>`;}
async function render(){if(!jobId){setNote('ไม่พบหมายเลขงาน',true);return;}
 try{detail=await rpc('qa_vnext_job_detail',{p_job_id:jobId});media=await rpc('qa_vnext_media_list',{p_job_id:jobId});
 if(!Array.isArray(media))media=[];
 $('details').innerHTML=`<h2>1. ข้อมูลการแจ้งเรื่อง — ${esc(detail.job_id)}</h2><div class="row"><p><b>ประเภทงาน:</b> ${esc(detail.source_type||'-')}</p><p><b>Serial Number:</b> ${esc(detail.serial_no||'-')}</p><p><b>ฝ่ายผู้แจ้ง:</b> ${esc(detail.from_department||'-')}</p></div><div class="row"><p><b>Customer Name:</b> ${esc(detail.customer_name||'-')}</p><p><b>Country:</b> ${esc(detail.country||'-')}</p></div><p><b>Remark:</b> ${esc(detail.requester_remark||'-')}</p><p class="muted">วันที่สร้าง: ${esc(detail.created_at?new Date(detail.created_at).toLocaleString('th-TH'):'-')}</p>`;
 const list=$('assignments');list.replaceChildren();if(!detail.assignments?.length){list.innerHTML='<section class="sheet">ใบงานนี้ยังไม่แยกเป็นหลายฝ่าย <a href="job.html?id='+encodeURIComponent(jobId)+'">เปิดหน้าใบงานเดิม</a></section>';return;}
 for(const a of detail.assignments){const mine=QA.profile?.department===a.department_code||QA.profile?.role==='system_admin';const head=QA.profile?.role==='system_admin'||(mine&&QA.profile?.role==='department_admin');
 const el=document.createElement('section');el.className='sheet';el.dataset.assignment=a.assignment_id;
 const issueIds=(a.issues||[]).map(i=>i.issue_id);
 const blocks=await Promise.all((a.issues||[]).map(async(i,k)=>`<article class="issue"><h3>ปัญหา ${esc(i.issue_number)} — ${esc(i.category_code)}</h3><p>${esc(i.description)}</p><b>ไฟล์แนบจากผู้แจ้ง</b>${await mediaFor([i.issue_id],null)}${detail.can_manage_issues?`<div class=\"no-print\"><label>เพิ่มไฟล์ของปัญหา ${i.issue_number}<input class=\"issueFiles\" data-issue-number=\"${i.issue_number}\" type=\"file\" accept=\"image/jpeg,image/png,image/webp,video/mp4,video/webm\" multiple></label></div>`:''}</article>`));
 const responseMedia=await mediaFor([],a.assignment_id);
 el.innerHTML=`<h2>2. รายละเอียดปัญหา — ${esc(a.department_code)} <span class="badge">${esc(label(a.status))}</span></h2>${blocks.join('')}
 <h2>3. การดำเนินการของฝ่ายรับเรื่อง</h2><p><b>ผู้รับผิดชอบหลัก:</b> ${esc(a.responsible_name||a.responsible_user||'ยังไม่รับงาน')}</p>
 <div class="row"><label>วันกำหนดเสร็จ<input class="due" type="date" value="${esc(a.due_date||'')}" ${!mine||a.status!=='IN_PROGRESS'?'disabled':''}></label></div>
 <label class="field">รายละเอียดปัญหา<textarea class="recv" ${!mine||a.status!=='IN_PROGRESS'?'disabled':''}>${esc(a.receiver_problem_detail||'')}</textarea></label>
 <label class="field">วิเคราะห์สาเหตุ<textarea class="analysis" ${!mine||a.status!=='IN_PROGRESS'?'disabled':''}>${esc(a.problem_analysis||'')}</textarea></label>
 <label class="field">การแก้ไข<textarea class="fix" ${!mine||a.status!=='IN_PROGRESS'?'disabled':''}>${esc(a.corrective_action||'')}</textarea></label>
 <h3>ไฟล์แนบฝ่ายรับเรื่อง</h3>${responseMedia}
 ${mine&&a.status==='IN_PROGRESS'?`<div class="no-print"><label>แนบรูป/วิดีโอ (สูงสุด 5 รูป และ 1 วิดีโอ)<input class="responseFiles" type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm" multiple></label></div>`:''}
 <p class="muted">ผู้รับผิดชอบอัปเดตได้ร่วมกันในแผนก · หัวหน้าเป็นผู้อนุมัติ</p><div class="no-print actions"></div>
 <h3>4. การตรวจสอบและอนุมัติ</h3><p>${a.approved_at?'อนุมัติเมื่อ '+esc(new Date(a.approved_at).toLocaleString('th-TH')):esc(label(a.status))}</p>`;
 for(const inp of el.querySelectorAll('.issueFiles'))inp.addEventListener('change',async()=>{const files=[...inp.files];inp.disabled=true;
  try{await uploadIssue(+inp.dataset.issueNumber,files);setNote('เพิ่มไฟล์แนบเรียบร้อย');await render();}catch(e){setNote('เพิ่มไฟล์ไม่สำเร็จ: '+e.message,true);}finally{inp.disabled=false;}});
 const actions=el.querySelector('.actions');
 function btn(text,action,color='secondary'){const b=document.createElement('button');b.textContent=text;b.className=color;b.onclick=()=>act(a,action,el);actions.append(b);}
 if(mine&&a.status==='OPEN')btn('รับงาน','ACCEPT');
 if(mine&&a.status==='IN_PROGRESS'){btn('บันทึกร่าง','SAVE_DRAFT');btn('ส่งให้หัวหน้าตรวจสอบ','REQUEST_APPROVAL');}
 if(head&&a.status==='WAITING_REVIEW'){btn('อนุมัติและส่งผล','APPROVE');btn('ส่งกลับแก้ไข','RETURN','danger');}
 list.append(el);
 }
 }catch(e){setNote('อ่านใบงานไม่สำเร็จ: '+e.message,true);$('details').textContent='โปรดตรวจสิทธิ์ หรือกลับไปเปิดใบงานเดิม';}}
async function act(a,action,el){let data={};if(action==='SAVE_DRAFT'||action==='REQUEST_APPROVAL'){data={receiver_problem_detail:el.querySelector('.recv').value,problem_analysis:el.querySelector('.analysis').value,corrective_action:el.querySelector('.fix').value,due_date:el.querySelector('.due').value};}
 if(action==='REQUEST_APPROVAL'&&el.querySelector('.responseFiles')?.files?.length){setNote('กรุณากดบันทึกร่างเพื่ออัปโหลดไฟล์แนบก่อน แล้วจึงส่งให้หัวหน้าตรวจสอบ',true);return;}
 if(action==='RETURN'){const reason=prompt('ระบุสาเหตุที่ส่งกลับแก้ไข');if(!reason)return;data={reason};}
 if(action==='APPROVE'&&!confirm('ยืนยันอนุมัติและส่งผลการดำเนินงานของแผนกนี้?'))return;
 try{setNote('กำลังบันทึก...');let expected=a.version;
 if(action==='REQUEST_APPROVAL'){
   // Save any visible edits before requesting review; never silently discard input.
   const saved=await rpc('qa_vnext_assignment_action',{p_assignment_id:a.assignment_id,p_action:'SAVE_DRAFT',p_expected_version:expected,p_data:data});expected=saved.version;
 }
 const {data:result,error}=await QA.client.rpc('qa_vnext_assignment_action',{p_assignment_id:a.assignment_id,p_action:action,p_expected_version:expected,p_data:action==='REQUEST_APPROVAL'?{}:data});if(error)throw error;
 if(action==='SAVE_DRAFT'||action==='REQUEST_APPROVAL'){const files=[...el.querySelector('.responseFiles')?.files||[]];if(files.length){if(action==='REQUEST_APPROVAL')throw new Error('บันทึกข้อความแล้วและส่งตรวจสอบแล้ว แต่ไฟล์ยังไม่ได้อัปโหลด กรุณาแนบไฟล์และบันทึกร่างก่อนส่งตรวจสอบครั้งถัดไป');await uploadResponse(a.assignment_id,files);}}
 setNote('บันทึกสำเร็จ');await render();}catch(e){setNote('ไม่สามารถบันทึกได้: '+e.message,true);}}
async function uploadIssue(issueNumber,files){const imgs=files.filter(f=>f.type.startsWith('image/'));const vids=files.filter(f=>f.type.startsWith('video/'));
 if(imgs.length>5||vids.length>1||imgs.length+vids.length!==files.length)throw new Error('เลือกได้สูงสุด 5 รูปและ 1 วิดีโอ');
 for(const f of files){const limit=f.type.startsWith('image/')?5242880:52428800;if(f.size>limit)throw new Error('ขนาดไฟล์เกิน '+f.name);
 const path=`${QA.profile.user_id}/${crypto.randomUUID()}.${f.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin'}`;
 const {error}=await QA.client.storage.from('qa-vnext-media').upload(path,f,{contentType:f.type,upsert:false});if(error)throw error;
 await rpc('qa_vnext_register_attachment',{p_job_id:jobId,p_scope:'ISSUE',p_issue_number:issueNumber,p_assignment_id:null,p_kind:f.type.startsWith('image/')?'IMAGE':'VIDEO',p_path:path,p_mime_type:f.type,p_size_bytes:f.size});}}
async function uploadResponse(assignmentId,files){const images=files.filter(f=>f.type.startsWith('image/')),videos=files.filter(f=>f.type.startsWith('video/'));
 if(images.length>5||videos.length>1||files.length!==images.length+videos.length)throw new Error('แนบได้สูงสุด 5 รูปและ 1 วิดีโอ');
 for(const f of files){const isImage=f.type.startsWith('image/'),limit=isImage?5242880:52428800;
 if(f.size>limit)throw new Error('ไฟล์เกินขนาด '+f.name);
 const ext=f.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin';const path=`${QA.profile.user_id}/${crypto.randomUUID()}.${ext}`;
 const {error}=await QA.client.storage.from('qa-vnext-media').upload(path,f,{contentType:f.type,upsert:false});if(error)throw error;
 await rpc('qa_vnext_register_attachment',{p_job_id:jobId,p_scope:'ASSIGNMENT',p_issue_number:null,p_assignment_id:assignmentId,p_kind:isImage?'IMAGE':'VIDEO',p_path:path,p_mime_type:f.type,p_size_bytes:f.size});
 }}
async function canvasExport(mode){const btns=document.querySelectorAll('.no-print');btns.forEach(n=>n.style.display='none');try{
 if(!window.html2canvas)await loadScript('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js');
 const node=$('captureArea');const c=await html2canvas(node,{backgroundColor:'#ffffff',scale:Math.min(2,window.devicePixelRatio||2),useCORS:true,logging:false});
 if(mode==='png'){const a=document.createElement('a');a.download=jobId+'.png';a.href=c.toDataURL('image/png');a.click();return;}
 if(!window.jspdf)await loadScript('https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js');
 const pdf=new window.jspdf.jsPDF({unit:'mm',format:'a4'});const pw=210,ph=297,margin=8,imgW=pw-2*margin,ratio=c.width/imgW;
 const pageH=Math.floor((ph-2*margin)*ratio);for(let y=0,n=0;y<c.height;y+=pageH,n++){
 const slice=document.createElement('canvas');slice.width=c.width;slice.height=Math.min(pageH,c.height-y);slice.getContext('2d').drawImage(c,0,y,c.width,slice.height,0,0,c.width,slice.height);
 if(n)pdf.addPage();pdf.addImage(slice.toDataURL('image/jpeg',0.89),'JPEG',margin,margin,imgW,slice.height/ratio);}
 pdf.save(jobId+'.pdf');
 }finally{btns.forEach(n=>n.style.display='');}}
function loadScript(src){return new Promise((ok,no)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>no(new Error('โหลดไลบรารี Export ไม่ได้'));document.head.append(s);});}
$('pdfButton').onclick=()=>canvasExport('pdf').catch(e=>setNote('Export PDF ไม่สำเร็จ: '+e.message,true));
$('pngButton').onclick=()=>canvasExport('png').catch(e=>setNote('Export PNG ไม่สำเร็จ: '+e.message,true));
async function boot(){for(let i=0;i<160&&!QA.profile;i++)await new Promise(r=>setTimeout(r,100));if(!QA.profile){setNote('Login ไม่พร้อม',true);return;}await render();}
boot();
})();
