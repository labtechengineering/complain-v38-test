(()=>{'use strict';const $=id=>document.getElementById(id), esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const jobId=new URLSearchParams(location.search).get('id')||new URLSearchParams(location.search).get('job');let detail,media=[];const responseQueues=new Map(),responseDrafts=new Map();let activePickers=[];let mediaRoundReady=false;let departmentHighlightTimer;let issuerEntryNormalized=false;let trackerDepartment=new URLSearchParams(location.search).get('department')||'';let categoryNames=new Map();let receivingDepartments=[];let completedRounds=new Map();
const jobQuery=new URLSearchParams(location.search);
const fromAllJobs=jobQuery.get('from')==='all-jobs';
if(fromAllJobs){
 const back=document.querySelector('.job-home'),url=new URLSearchParams({view:'all'}),scope=jobQuery.get('scope');
 if(['department','mine'].includes(scope))url.set('scope',scope);
 back.href='dashboard.html?'+url.toString();
 back.textContent='กลับรายการงานทั้งหมด';
}
function requestEditError(e){const text=e?.message||String(e);if(text.includes('VERSION_CONFLICT'))return 'มีคนแก้ไขข้อมูลระหว่างเปิดหน้านี้ กรุณาเปิดแก้ไขใหม่';if(text.includes('REQUEST_ROUTING_LOCKED')||text.includes('JOB_ALREADY_ACCEPTED_OR_ACTIVE'))return 'มีแผนกรับงานแล้ว กรุณาเปิดฟอร์มใหม่เพื่อแก้เฉพาะรายละเอียดใบแจ้ง';if(text.includes('DEPARTMENT_HAS_SAVED_WORK_KEEP_ASSIGNED'))return 'แผนกนี้มีคำตอบหรือไฟล์เดิมอยู่ ต้องคงแผนกนี้ไว้เพื่อรักษาข้อมูล สามารถเพิ่มแผนกอื่นได้';if(text.includes('SELF_RESPONSE_EXISTING_OWNER'))return 'แผนกผู้แจ้งมีผู้รับงานหรือข้อมูลคำตอบแล้ว';if(text.includes('SELF_RESPONSE_ISSUE_CLOSED'))return 'ปัญหานี้ปิดแล้ว';if(['PGRST202','42883'].includes(String(e?.code||'')))return 'กรุณารัน SQL ชุดแก้ไขข้อมูลใบแจ้งก่อน';return text;}
async function openRequestHeaderEditor(appendOnly=false){
 if($('requestHeaderEditor')){$('requestHeaderEditor').scrollIntoView({behavior:'smooth',block:'start'});return;}
 const values=appendOnly?await Promise.all([QA.api.getSettings(),rpc('qa_vnext_receivers',{})]).then(([settings,receivers])=>({
  issues:[],receivers,categories:settings.categories.map(c=>({...c,is_other:/^OTHERS?$/i.test(c.code)||/(อื่น|\bothers?\b)/i.test(c.name)}))
 })) : await rpc('qa_request_full_v1',{p_job_id:jobId});
 const form=document.createElement('form');form.id='requestHeaderEditor';form.className='request-header-editor no-print';
 form.innerHTML='<h3>แก้ไขใบแจ้ง</h3><div class="request-header-grid"><label>ประเภทงาน<select name="source_type" required><option value="PRODUCTION">PRODUCTION</option><option value="AFTERSALES">AFTERSALES</option></select></label><label>Serial Number<input name="serial_no" maxlength="500"></label><label>ลูกค้า<input name="customer_name" maxlength="200"></label><label>ประเทศ<input name="country" maxlength="120"></label><label class="request-header-wide">Remark<textarea name="requester_remark" maxlength="20000"></textarea></label></div><div class="request-issues"></div><button type="button" class="secondary request-add-issue">+ เพิ่มปัญหา</button><p class="request-editor-status" role="status"></p><div class="request-header-actions"><button type="submit">บันทึกใบแจ้ง</button><button type="button" class="secondary request-header-cancel">ยกเลิก</button></div>';
 for(const key of ['source_type','serial_no','customer_name','country','requester_remark'])form.elements.namedItem(key).value=values[key]||'';
 if(appendOnly){
  form.querySelector('h3').textContent='เพิ่มปัญหาในใบงานนี้';
  form.querySelector('.request-header-grid').remove();
  form.querySelector('button[type=submit]').textContent='บันทึกปัญหา';
 }
 const cards=[],pickers=[],notes=[];let dirty=false,busy=false,savedResult=null;
 const submitLabel=appendOnly?'บันทึกปัญหา':'บันทึกใบแจ้ง';
 let requestId;
 const feedback=(message,bad=false)=>{const node=form.querySelector('.request-editor-status');node.textContent=message;node.style.color=bad?'#b91c1c':'#166534';};
 const unload=e=>{if(dirty||busy){e.preventDefault();e.returnValue='';}};window.addEventListener('beforeunload',unload);
 form.addEventListener('input',()=>dirty=true);form.addEventListener('change',()=>dirty=true);
 form._dispose=()=>{if(previewObserver)for(const element of form.querySelectorAll('[data-job-media-preview]'))previewObserver.unobserve(element);pickers.forEach(p=>p.destroy());window.removeEventListener('beforeunload',unload);if($('allIssues'))$('allIssues').hidden=false;};
 const categories=values.categories||[];
 const routingLocked=!appendOnly&&values.routing_locked===true;
 form.querySelector('.request-add-issue').hidden=routingLocked;
 async function addCard(issue={}){
  const card=document.createElement('section');card.className='request-issue-card';card.dataset.issueId=issue.issue_id||'';
  const row={card,issue,entries:[],picker:null};cards.push(row);
  card.innerHTML='<div class="request-issue-heading"><h4></h4>'+(!issue.issue_id?'<button type="button" class="secondary request-remove-issue">ลบปัญหาที่เพิ่ม</button>':'')+'</div><div class="request-header-grid"><label>ประเภทปัญหา<select class="request-category" required><option value="">เลือกประเภทปัญหา</option>'+categories.filter(c=>c.active!==false||c.code===issue.category_code).map(c=>'<option value="'+esc(c.code)+'">'+esc(c.name||c.code)+'</option>').join('')+'</select></label><label class="request-other-label" hidden>ระบุประเภทอื่นๆ<input class="request-other" maxlength="120"></label><label class="request-header-wide">รายละเอียดปัญหา<textarea class="request-description" required maxlength="20000"></textarea></label></div><div class="qa-issue-classification"></div><label class="request-due-field">วันกำหนดเสร็จ<input class="request-issue-due" type="date"></label><fieldset class="request-receivers"><legend>ฝ่ายรับเรื่อง · เลือกได้หลายแผนก</legend></fieldset><div class="request-existing-media"></div><div class="request-issue-picker"></div>';
  window.QAIssueClassification?.mount(card.querySelector('.qa-issue-classification'),{
   key:crypto.randomUUID(),severity:issue.severity_code,occurrence:issue.occurrence_type,required:!issue.issue_id
  });
  if(appendOnly&&canSelfRespond()){
   const self=document.createElement('label');self.className='qa-issue-self';
   self.innerHTML='<input class="request-self" type="checkbox"> ผู้แจ้งตอบปัญหานี้เอง';
   card.querySelector('.request-receivers').before(self);
  }
  const renumber=()=>cards.forEach((r,n)=>r.card.querySelector('h4').textContent='ปัญหา '+(r.issue.issue_number||n+1)+(r.issue.issue_id?'':' (ใหม่)'));renumber();
  const category=card.querySelector('.request-category'),other=card.querySelector('.request-other');category.value=issue.category_code||'';other.value=issue.category_other||'';card.querySelector('.request-description').value=issue.description||'';
  const deadline=card.querySelector('.request-issue-due');
  deadline.value=issue.issue_id?(issue.request_due_date||values.request_due_date||''):'';
  deadline.required=!issue.issue_id||Boolean(deadline.value);
  const syncOther=()=>{const show=!!categories.find(c=>c.code===category.value)?.is_other;card.querySelector('.request-other-label').hidden=!show;other.required=show;if(!show)other.value='';};category.onchange=syncOther;syncOther();
  const current=issue.departments||[],receivers=new Map((values.receivers||[]).filter(r=>r.enabled!==false).map(r=>[String(r.department_code||r.code),r]));for(const code of current)if(!receivers.has(code))receivers.set(code,{code,enabled:false});
  const receiverGroup=card.querySelector('.request-receivers');
  if(routingLocked)receiverGroup.querySelector('legend').textContent='ฝ่ายรับเรื่อง';
  for(const [code,r] of receivers){
   const checked=current.includes(code);
   if(routingLocked&&!checked)continue;
   const protectedDepartment=checked&&(values.protected_departments||[]).includes(code);
   const disabled=routingLocked||protectedDepartment||r.enabled===false;
   const label=document.createElement('label');
   label.className='request-department-choice';
   label.innerHTML='<input type="checkbox" value="'+esc(code)+'" '+(checked?'checked ':'')+
    (disabled?'disabled':'')+'>'+esc(code)+(protectedDepartment&&!routingLocked?' (มีข้อมูลเดิม)':r.enabled===false&&!routingLocked?' (ปิดรับงาน)':'');
   receiverGroup.append(label);
  }
  if(routingLocked&&!current.length)receiverGroup.append('ยังไม่มีฝ่ายรับเรื่อง');
  card.querySelector('.request-remove-issue')?.addEventListener('click',()=>{if(busy||appendOnly&&cards.length===1)return;if(row.entries.length&&!confirm('ลบปัญหาที่เพิ่มนี้พร้อมไฟล์ที่ยังไม่ได้บันทึก?'))return;row.picker?.destroy();cards.splice(cards.indexOf(row),1);card.remove();renumber();dirty=true;});
  form.querySelector('.request-issues').append(card);
  const old=media.filter(m=>m.scope==='ISSUE'&&String(m.issue_id)===String(issue.issue_id));
  if(old.length){card.querySelector('.request-existing-media').innerHTML='<b>ไฟล์เดิม</b>'+mediaFor([issue.issue_id],null,false);for(const m of old){const label=document.createElement('label');label.textContent='หมายเหตุไฟล์ '+(old.indexOf(m)+1);const input=document.createElement('textarea');input.value=m.note||'';input.maxLength=2000;label.append(input);card.querySelector('.request-existing-media').append(label);notes.push({id:m.attachment_id,input,saved:m.note||''});}}
  row.picker=QAMediaPicker.mount(card.querySelector('.request-issue-picker'),{entries:row.entries,existing:{images:old.filter(m=>m.kind==='IMAGE').length,videos:old.filter(m=>m.kind==='VIDEO').length},onChange:()=>{dirty=true;if(form.querySelector('.request-editor-status').textContent===QAMediaPicker.preparingMessage&&!pickers.some(p=>p.isPreparing()))feedback('');},onError:m=>feedback(m,true)});pickers.push(row.picker);
  return row;
 }
 if(appendOnly)await addCard();else for(const issue of values.issues||[])await addCard(issue);
 form.querySelector('.request-add-issue').onclick=async()=>{if(busy||savedResult)return;const row=await addCard();dirty=true;row.card.scrollIntoView({behavior:'smooth',block:'center'});row.card.querySelector('select').focus();};
 form.querySelector('.request-header-cancel').onclick=()=>{if(busy)return;if(dirty&&!confirm(savedResult?'ข้อมูลใบแจ้งบันทึกแล้ว แต่ยังมีไฟล์ค้างส่ง ต้องการปิดฟอร์มหรือไม่?':'ยกเลิกข้อมูลที่แก้ไขและไฟล์ที่ยังไม่ได้บันทึก?'))return;form._dispose();form.remove();if(savedResult)void render();};
 form.onsubmit=async event=>{event.preventDefault();if(busy)return;if(pickers.some(p=>p.isPreparing())){feedback(QAMediaPicker.preparingMessage);return;}if(!savedResult&&!form.reportValidity())return;
  let payload;
  if(!savedResult){
   const issues=cards.map(({card,issue})=>{
    const self=card.querySelector('.request-self')?.checked===true;
    const departments=[...card.querySelectorAll('.request-receivers input:checked')].map(n=>n.value);
    if(self&&!departments.includes(detail.from_department))departments.unshift(detail.from_department);
    return {issue_id:issue.issue_id||null,category_code:card.querySelector('.request-category').value,
     category_other:card.querySelector('.request-other').value.trim(),description:card.querySelector('.request-description').value.trim(),
     request_due_date:card.querySelector('.request-issue-due').value||null,departments,
     ...(window.QAIssueClassification?QAIssueClassification.read(card):{}),...(self?{self_response:true}:{})};
   });
   if((appendOnly&&!issues.length)||issues.some(i=>!i.category_code||!i.description||(!i.issue_id&&!i.departments.length))){
    feedback('กรอกประเภทและรายละเอียดให้ครบ แล้วเลือกฝ่ายรับเรื่องอย่างน้อย 1 แผนกหรือเลือกตอบเอง',true);return;
   }
   if(appendOnly)payload={p_job_id:jobId,p_issues:issues,p_request_id:requestId||=crypto.randomUUID()};
   else payload={p_job_id:jobId,p_values:{
    header:Object.fromEntries(['source_type','serial_no','customer_name','country','requester_remark'].map(k=>[k,form.elements.namedItem(k).value])),issues
   },p_expected_version:values.version,p_expected_snapshot:values.snapshot};
  }
  busy=true;const button=form.querySelector('[type=submit]');button.disabled=true;for(const input of form.querySelectorAll('.request-issue-picker input[type=file]'))input.disabled=true;form.querySelector('.request-add-issue').disabled=true;form.querySelector('.request-header-cancel').disabled=true;
  try{
   if(!savedResult){feedback('กำลังบันทึกใบแจ้ง...');savedResult=await rpc(appendOnly?'qa_r16_append_issues':'qa_request_full_v1',payload);
    for(const [n,row] of cards.entries())row.issue={...row.issue,...savedResult.saved_issues[n]};queueRequestEvents(savedResult.receiver_events||[]);
    for(const input of form.querySelectorAll('input,select,textarea,.request-remove-issue'))input.disabled=true;
   }
   feedback('บันทึกใบแจ้งแล้ว กำลังบันทึกไฟล์แนบ...');
   for(const row of cards){for(const entry of row.entries)await uploadRequestEntry(row.issue.issue_number,entry);row.picker.render();}
   for(const note of notes)if(note.input.value!==note.saved){await rpc('qa_v38_media_set_note',{p_attachment_id:note.id,p_note:note.input.value});note.saved=note.input.value;}
   dirty=false;form._dispose();
   const issueId=savedResult.saved_issues[0]?.issue_id;
   await render(appendOnly?{issueId,navigate:true}:{});
   setNote(appendOnly?'เพิ่มปัญหาในใบงานเรียบร้อย':'บันทึกใบแจ้งและไฟล์แนบเรียบร้อย');await sendRequestLines();
  }catch(e){feedback((savedResult?'ข้อมูลใบแจ้งบันทึกแล้ว มีไฟล์หรือหมายเหตุที่ยังไม่สำเร็จ กดบันทึกไฟล์ที่ค้างอีกครั้ง: ':'บันทึกไม่สำเร็จ: ')+requestEditError(e),true);button.textContent=savedResult?'บันทึกไฟล์ที่ค้างอีกครั้ง':submitLabel;button.disabled=false;if(!savedResult)for(const input of form.querySelectorAll('.request-issue-picker input[type=file]'))input.disabled=false;form.querySelector('.request-add-issue').disabled=!!savedResult;form.querySelector('.request-header-cancel').disabled=false;
  }finally{busy=false;}
 };
 $('details').append(form);if($('allIssues'))$('allIssues').hidden=true;observePreviews(form);form.scrollIntoView({behavior:'smooth',block:'start'});(form.elements.namedItem('source_type')||form.querySelector('.request-category')).focus();
}
async function uploadRequestEntry(issueNumber,entry){
 const file=entry.file;QAMediaPicker.validate([file]);
 if(!entry.attachmentId){const path=QA.profile.user_id+'/'+crypto.randomUUID()+'.'+(file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin');
  const {error}=await QA.client.storage.from('qa-vnext-media').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;
  try{const registered=await rpc('qa_vnext_register_attachment',{p_job_id:jobId,p_scope:'ISSUE',p_issue_number:issueNumber,p_assignment_id:null,p_kind:file.type.startsWith('image/')?'IMAGE':'VIDEO',p_path:path,p_mime_type:file.type,p_size_bytes:file.size});if(!registered?.attachment_id)throw Error('ลงทะเบียนไฟล์แนบไม่สำเร็จ');entry.attachmentId=registered.attachment_id;}
  catch(e){try{await QA.client.storage.from('qa-vnext-media').remove([path]);}catch{}throw e;}
 }
 if((entry.note||'')!==entry.savedNote){if(entry.note||entry.savedNote!==undefined)await rpc('qa_v38_media_set_note',{p_attachment_id:entry.attachmentId,p_note:entry.note||''});entry.savedNote=entry.note||'';}
}
function issueLineEvent(event){
 const departments=[...new Set(event.new_departments||event.departments||[])].sort();
 const before=[...new Set(event.old_departments||[])].sort();
 if(!event.event_id||!departments.length||event.confirm_original||departments.join(',')===before.join(','))return null;
 return {...event,new_departments:departments};
}
function queueRequestEvents(events){events=events.map(issueLineEvent).filter(Boolean);if(!events.length)return;const key='qa-full-edit-lines:'+jobId;let prior=[];try{prior=JSON.parse(sessionStorage.getItem(key)||'[]');}catch{}const merged=new Map([...prior,...events].map(e=>[e.event_id,e]));sessionStorage.setItem(key,JSON.stringify([...merged.values()]));}
function requestLineRetry(){let b=$('retryRequestLines');if(!b){b=document.createElement('button');b.id='retryRequestLines';b.type='button';b.className='secondary no-print';$('feedback').insertAdjacentElement('afterend',b);}b.textContent='ส่ง LINE ที่ค้างอีกครั้ง';b.hidden=false;b.onclick=()=>sendRequestLines();if($('retryReceiverLine'))$('retryReceiverLine').hidden=true;}
let requestLinesBusy=false;
async function sendRequestLines(){if(requestLinesBusy)return;requestLinesBusy=true;const key='qa-full-edit-lines:'+jobId;try{let pending=JSON.parse(sessionStorage.getItem(key)||'[]');if($('retryRequestLines'))$('retryRequestLines').hidden=true;
 while(pending.length){const done=await notifyReceiverChange(pending[0]);if(!done){requestLineRetry();return;}pending.shift();sessionStorage.setItem(key,JSON.stringify(pending));}
 sessionStorage.removeItem(key);
 }finally{requestLinesBusy=false;}}
function formatRequestDate(date){
 return new Intl.DateTimeFormat('th-TH',{dateStyle:'medium',timeZone:'Asia/Bangkok'}).format(new Date(date+'T00:00:00+07:00'));
}
function responseStatus(a,canReopen){
 const state=String(a.status||'').toUpperCase();let title;
 if(state==='CLOSED')title='ผู้แจ้งตรวจรับผ่านแล้ว — ปิดงาน';
 else if(state==='WAITING_REVIEW')title='ส่งงานแล้ว — รอฝ่ายผู้แจ้งตรวจรับ';
 else if(state==='IN_PROGRESS'&&a.approval_requested_at)title='ส่งให้หัวหน้าตรวจสอบแล้ว — รอหัวหน้าอนุมัติ';
 else if(state==='IN_PROGRESS'&&a.needs_rework)title='ส่งกลับแก้ไข';
 else if(state==='IN_PROGRESS')title='กำลังดำเนินการ — ยังไม่ได้ส่งตรวจรับ';
 else title=label(a.status);
 const approved=a.approved_at?'<p class="response-status-meta">หัวหน้าแผนกรับเรื่องอนุมัติเมื่อ '+esc(new Date(a.approved_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'}))+'</p>':'';
 return '<section class="response-status-box" role="status"><h3>สถานะการส่งงาน</h3><p class="response-status-title">'+esc(title)+'</p>'+approved+(canReopen?'<p class="response-status-meta">ยังแก้ไขได้ก่อนตรวจรับ กด “แก้ไขรายละเอียด” เพื่อกลับเป็นแบบร่าง และส่งตรวจใหม่หลังแก้ไข</p>':'')+'</section>';
}
async function loadCategoryNames(){const {data,error}=await QA.client.from('qa_settings').select('code,name').eq('setting_type','CATEGORY').range(0,999);if(error)throw error;categoryNames=new Map((data||[]).map(x=>[String(x.code),String(x.name||'')]));}
function categoryName(code,other=''){const key=String(code||'');return (categoryNames.get(key)||'ไม่พบชื่อประเภทปัญหา')+(String(other).trim()?': '+String(other).trim():'');}
const setNote=(s,bad=false)=>{$('feedback').textContent=s;$('feedback').style.color=bad?'#b91c1c':'#166534';};
async function rpc(name,args){const {data,error}=await QA.client.rpc(name,args);if(error)throw error;return data;}
function label(s){return QAStatus.label(QAStatus.canonical(s));}
function assignmentName(a){return a.department_code+(a.self_response?' · ตอบเอง':'');}
function assignmentStatus(a){
 if(a.status==='IN_PROGRESS'&&!a.approval_requested_at&&a.needs_rework)return 'ส่งกลับแก้ไข';
 if(a.self_response&&a.status==='IN_PROGRESS'){
  if(a.approval_requested_at)return 'รอหัวหน้าตรวจ';
  if(a.requester_review_reason)return 'ส่งกลับแก้ไข';
  return 'รอบันทึกคำตอบ';
 }
 return label(a.status);
}
function canAppendIssue(){return detail.is_requester&&['user','department_admin'].includes(QA.profile?.role)&&!detail._catalogOnly;}
function canSelfRespond(){return canAppendIssue()&&QA.profile.department===detail.from_department;}
async function selfAction(issueId,action,button,assignment,fields={}){
 button.disabled=true;
 try{
  if(window.QAWork&&!await QAWork.flushAll())throw Error('ยังมีคอมเมนต์ที่บันทึกไม่สำเร็จ');
  const result=await rpc('qa_r16_self_response',{p_issue_id:issueId,p_action:action,p_expected_version:assignment?.version??null,p_data:fields});
  await render({issueId,assignmentId:result?.assignment_id??assignment?.assignment_id,navigate:true});
  setNote(({START:'กรอกคำตอบในส่วนของผู้แจ้งได้เลย',SUBMIT:QA.profile.role==='department_admin'?'บันทึกคำตอบแล้ว':'ส่งให้หัวหน้าตรวจแล้ว',APPROVE:'อนุมัติคำตอบแล้ว',RETURN:'ส่งกลับให้ผู้แจ้งแก้ไขแล้ว'})[action]);
 }catch(error){setNote('บันทึกคำตอบไม่สำเร็จ: '+requestEditError(error),true);}
 finally{button.disabled=false;}
}
const signedUrls=new Map();
async function getUrl(path,download=false){
 const key=JSON.stringify([path,download]),cached=signedUrls.get(key);
 if(cached&&cached.expires>Date.now())return cached.promise;
 const entry={expires:Date.now()+14*60*1000};
 entry.promise=(async()=>{const {data,error}=await QA.client.storage.from('qa-vnext-media').createSignedUrl(path,900,download?{download:true}:undefined);if(error)throw error;return data.signedUrl;})();
 signedUrls.set(key,entry);try{return await entry.promise;}catch(error){if(signedUrls.get(key)===entry)signedUrls.delete(key);throw error;}
}
async function loadMedia(){try{return {rows:await rpc('qa_v52_media_list',{p_job_id:jobId}),roundReady:true};}
 catch(error){if(!['PGRST202','42883'].includes(String(error.code||'')))throw error;return {rows:await rpc('qa_vnext_media_list',{p_job_id:jobId}),roundReady:false};}}

function mediaFor(issueIds,assignmentId,canEdit=false,round=null){
 const permitted=media.filter(m=>(m.scope==='ISSUE'&&issueIds.includes(m.issue_id))||
  (m.scope==='ASSIGNMENT'&&m.assignment_id===assignmentId&&(round===null||Number(m.response_round||1)===Number(round))));
 if(!permitted.length)return '';
 const cards=permitted.map(m=>{
  const image=m.kind==='IMAGE',path=esc(m.storage_path),data=`data-job-media-path="${path}" data-job-media-kind="${image?'IMAGE':'VIDEO'}"`;
  const preview=image
   ? `<button type="button" class="qa-media-picture" ${data} aria-label="ดูรูป"><img data-job-media-preview="${path}" alt="ภาพแนบ" loading="lazy"></button>`
   : `<video class="qa-media-video" data-job-media-preview="${path}" controls playsinline controlslist="nofullscreen" preload="metadata"></video>`;
  const open=`<button type="button" class="qa-media-open" ${data}>${image?'ดูรูป':'ดูวิดีโอเต็มจอ'}</button>`;
  const note=canEdit?`<label>หมายเหตุ<textarea class="media-note-input" data-attachment="${esc(m.attachment_id)}" maxlength="2000">${esc(m.note||'')}</textarea></label><button type="button" class="media-note-save" data-attachment="${esc(m.attachment_id)}">บันทึกหมายเหตุ</button>`:`<p class="media-note">${esc(m.note||'')}</p>`;
  return `<div class="media-item">${preview}${open} ${note}<button type="button" class="qa-media-open" data-job-media-download="${path}">ดาวน์โหลด</button></div>`;
 });
 return `<div class="media">${cards.join('')}</div>`;
}
const loadingPreviews=new WeakSet();
async function loadPreview(element){
 if(!element.isConnected||element.hasAttribute('src')||loadingPreviews.has(element))return;
 loadingPreviews.add(element);
 try{
  const url=await getUrl(element.dataset.jobMediaPreview);
  if(element.isConnected&&url)element.src=url;
 }catch{}finally{loadingPreviews.delete(element);}
}
const previewObserver=typeof IntersectionObserver==='function'?new IntersectionObserver(entries=>{
 for(const entry of entries)if(entry.isIntersecting){
  previewObserver.unobserve(entry.target);
  void loadPreview(entry.target);
 }
},{rootMargin:'160px'}):null;
function observePreviews(root){
 for(const element of root.querySelectorAll('[data-job-media-preview]:not([src])')){
  if(previewObserver)previewObserver.observe(element);
  else if(!element.closest('[hidden],details:not([open])'))void loadPreview(element);
 }
}
const captureArea=$('captureArea');
captureArea.addEventListener('toggle',event=>{
 if(event.target.tagName==='DETAILS'&&event.target.open)observePreviews(event.target);
},true);
captureArea.addEventListener('click',async event=>{
 const download=event.target.closest('button[data-job-media-download]');
 if(download){
  download.disabled=true;
  try{
   const url=await getUrl(download.dataset.jobMediaDownload,true);
   if(!url)throw new Error('ไม่พบลิงก์ไฟล์');
   const link=document.createElement('a');
   link.href=url;link.download='';document.body.append(link);link.click();link.remove();
  }catch(e){setNote('ดาวน์โหลดไม่สำเร็จ: '+e.message,true);}
  finally{download.disabled=false;}
  return;
 }
 const button=event.target.closest('button[data-job-media-path]');
 if(!button)return;
 QAMediaViewer.open(button,{
  kind:button.dataset.jobMediaKind,
  getSource:()=>getUrl(button.dataset.jobMediaPath),
  inlineVideo:button.closest('.media-item')?.querySelector('video')
 });
});

// The persisted routing event retains the sender's authorization and idempotency.
// Send the affected issue with its current receiving departments.
async function ensureHtml2Canvas(){if(window.html2canvas)return;
 await new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';s.onload=resolve;s.onerror=()=>reject(new Error('โหลดเครื่องมือสร้างภาพไม่สำเร็จ'));document.head.append(s);});}
async function routedIssuePng(ev){
 await ensureHtml2Canvas();
 const live=(detail.assignments||[]).flatMap(a=>a.issues||[]).find(i=>String(i.issue_id)===String(ev.issue_id));
 const issue=live||{description:ev.issue_description,category_code:ev.category_code,category_other:ev.category_other,issue_number:ev.issue_number};
 if(!issue.description)throw new Error('ไม่พบข้อมูลปัญหาที่ส่งต่อ');
 const code=String(detail.car_code||jobId)+'-'+String(issue.issue_number||ev.issue_number||1).padStart(2,'0');
 const field=(key,val)=>'<div style="display:grid;grid-template-columns:155px minmax(0,1fr);gap:9px;line-height:1.6;overflow-wrap:anywhere"><b>'+esc(key)+'</b><span style="white-space:pre-wrap">'+esc(val||'-')+'</span></div>';
 const host=document.createElement('div');
 host.style.cssText='position:absolute;left:0;top:0;width:960px;background:#fff;padding:36px;font:18px Arial,Tahoma,sans-serif;line-height:1.65;z-index:999999;color:#172337';
 host.innerHTML='<h1 style="font-size:29px;line-height:1.35;margin:0 0 15px">Complain &amp; Action Tracking</h1><p style="margin:0 0 20px"><b>ใบแจ้งงาน:</b> '+esc(detail.car_code||jobId)+'</p>'+
   '<section style="padding:20px 22px;border:1px solid #d1d5db;border-radius:10px;margin-bottom:20px"><strong>1. ข้อมูลการแจ้งเรื่อง</strong><div style="display:grid;grid-template-columns:1fr 1fr;gap:9px 18px;margin-top:12px">'+
   field('ประเภท:',detail.source_type)+field('Serial:',detail.serial_no)+field('ลูกค้า:',detail.customer_name)+field('ประเทศ:',detail.country)+'</div></section>'+
   '<section style="padding:20px 22px;border:1px solid #d1d5db;border-radius:10px"><strong>2. รายละเอียดปัญหา · '+esc(code)+'</strong><div style="display:grid;gap:8px;margin-top:12px">'+
   field('Category:',categoryName(issue.category_code,issue.category_other||''))+field('ฝ่ายผู้แจ้ง:',detail.from_department==='SYSTEM'?'System Admin':detail.from_department)+field('ฝ่ายรับเรื่อง:',ev.new_departments.join(', '))+
   ((issue.request_due_date||detail.request_due_date)?field('วันกำหนดเสร็จ:',issue.request_due_date||detail.request_due_date):'')+field('รายละเอียดปัญหา:',issue.description)+'</div><div class="line-issue-media" style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px"></div></section>';
 const mediaBox=host.querySelector('.line-issue-media');
 const sourceMedia=media.filter(m=>m.scope==='ISSUE'&&String(m.issue_id)===String(ev.issue_id));
 await Promise.all(sourceMedia.map(async attachment=>{
  const card=document.createElement('div');card.style.cssText='width:170px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px';
  mediaBox.append(card);
  if(attachment.kind==='IMAGE'){
   const image=document.createElement('img');image.crossOrigin='anonymous';image.alt='ภาพประกอบ';
   image.style.cssText='display:block;width:170px;height:125px;object-fit:contain';
   try{image.src=await getUrl(attachment.storage_path);card.append(image);}catch{card.textContent='เปิดภาพประกอบไม่สำเร็จ';}
  }else card.textContent='วิดีโอแนบ';
  if(attachment.note){const note=document.createElement('p');note.textContent=attachment.note;card.append(note);}
 }));
 document.body.append(host);
 try {
  const images=[...host.querySelectorAll('img')];
  if(images.length){
   let timeout;
   await Promise.race([
    Promise.all(images.map(image=>image.decode?.().catch(()=>{})||Promise.resolve())),
    new Promise(resolve=>{timeout=setTimeout(resolve,6500);})
   ]).finally(()=>clearTimeout(timeout));
  }
  const canvas=await html2canvas(host,{scale:1,backgroundColor:'#fff',useCORS:true,logging:false});
  return canvas.toDataURL('image/png').split(',')[1];
 }finally{host.remove();}
}
function receiverChangeRetryButton(ev){let b=document.getElementById('retryReceiverLine');
 if(!b){b=document.createElement('button');b.id='retryReceiverLine';b.type='button';b.className='secondary';$('feedback').insertAdjacentElement('afterend',b);}
 b.textContent='ส่งรูปปัญหาเข้า LINE อีกครั้ง';b.onclick=()=>notifyReceiverChange(ev);b.hidden=false;
}
async function notifyReceiverChange(ev){
 const btn=document.getElementById('retryReceiverLine');if(btn)btn.hidden=true;
 const event=issueLineEvent(ev);
 if(!event){sessionStorage.removeItem('qa-v49-pending-line:'+jobId);return true;}
 try{setNote('บันทึกแผนกแล้ว กำลังส่งรูปปัญหาเข้า LINE...');
  const png=await routedIssuePng(event);
  const {data,error}=await QA.client.functions.invoke('vnext-receiver-change-line',{body:{event_id:ev.event_id,png_base64:png}});
  if(error)throw new Error(error.message||String(error));
  if(data?.error)throw new Error(data.error);
  if(data?.skipped)throw new Error(data.reason||'ยังไม่ตั้งค่ากลุ่ม LINE');
  if(!data?.sent)throw new Error('LINE ไม่ยืนยันการส่ง');
  sessionStorage.removeItem('qa-v49-pending-line:'+jobId);
  setNote(data.already_sent?'เปลี่ยนแผนกสำเร็จ และรูปปัญหาส่งไปแล้ว':'เปลี่ยนแผนกสำเร็จ และส่งรูปปัญหาเข้า LINE แล้ว');return true;
 }catch(e){setNote('เปลี่ยนแผนกใน Supabase สำเร็จแล้ว แต่ LINE ยังไม่สำเร็จ: '+e.message,true);receiverChangeRetryButton(ev);return false;}
}

function captureDetailFocus(){
 const fold=[...document.querySelectorAll('.issue-disclosure')].find(n=>n.open);
 const focused=fold?.querySelector('.workflow-focus');
 return {issueId:fold?.dataset.issueId,assignmentId:focused?.dataset.assignment,
  departmentOpen:[...document.querySelectorAll('.department-disclosure[open]')].map(n=>n.dataset.departmentFold),
  sourceOpen:[...document.querySelectorAll('.issue-department-group')].filter(g=>g._sourceDisclosure?.open).map(g=>g.dataset.assignment),
  historyOpen:[...document.querySelectorAll('.prior-round-disclosure')].filter(n=>n.open).map(n=>n.querySelector('summary')?.textContent)};
}
function guideDetail(context={}){
 const all=detail?.assignments||[],rights=a=>QAWorkflow.permissions(QA.profile,detail,a,{legacyLocked:a._legacyLocked===true});
 const actionable=all.filter(a=>QAWorkflow.notices(QA.profile,detail,[a]).some(n=>n.action));
 const pending=all.filter(a=>{const q=rights(a);return q.canResolveUnrelated||q.canFinalReview||q.canApprove;});
 const hashIssue=QAStatus.issueFromHash(location.hash);
 const initial=!context.action&&!context.navigate&&!context.issueId&&!context.assignmentId;
 // A read-only visit starts at the status flow. A URL department/hash alone
 // must not turn somebody else's update into an action for this user.
 if(initial&&!actionable.length){
  document.querySelectorAll('.workflow-focus').forEach(n=>{n.classList.remove('workflow-focus');n.querySelector(':scope > .workflow-focus-hint')?.remove();});
  return;
 }
 const candidates=initial?actionable:all;
 let issueId=context.issueId||hashIssue,assignment=all.find(a=>String(a.assignment_id)===String(context.assignmentId));
 // After finishing a review, lead to the next pending decision when there is one.
 if(['APPROVE','RETURN','REQUESTER_PASS','UNRELATED_CONFIRM'].includes(context.action)&&pending.length){assignment=pending[0];issueId=assignment.issues?.[0]?.issue_id;}
 if(!assignment&&issueId)assignment=candidates.find(a=>(a.issues||[]).some(i=>String(i.issue_id)===String(issueId))&&(!trackerDepartment||a.department_code===trackerDepartment));
 if(!assignment&&trackerDepartment)assignment=candidates.find(a=>a.department_code===trackerDepartment);
 if(!assignment)assignment=pending[0]||candidates.find(a=>rights(a).canEdit)||candidates.find(a=>rights(a).canAccept);
 if(!assignment)return;
 const folds=[...document.querySelectorAll('.issue-disclosure')];
 const applies=f=>f.dataset.assignmentIds.split(',').includes(String(assignment.assignment_id));
 const fold=folds.find(f=>applies(f)&&String(f.dataset.issueId)===String(issueId))||folds.find(applies);
 if(!fold)return;fold._openIssue();
 const group=[...fold.querySelectorAll('.issue-operation-group')].find(g=>g.dataset.assignment===String(assignment.assignment_id));
 const departmentFold=group?.closest('.department-disclosure');
 if(departmentFold)departmentFold.open=true;
 const source=[...fold.querySelectorAll('.received-issues')].find(n=>n.querySelector('.unaccepted-actions')?.dataset.assignment===String(assignment.assignment_id))||
  [...document.querySelectorAll('.issue-department-group')].find(g=>g.dataset.assignment===String(assignment.assignment_id))?._sourceDisclosure;
 const q=rights(assignment),review=q.canApprove||q.canFinalReview,unrelated=q.canResolveUnrelated;
 if(source?.tagName==='DETAILS')source.open=review||(context.sourceOpen||[]).includes(String(assignment.assignment_id));
 for(const old of fold.querySelectorAll('.prior-round-disclosure'))old.open=(context.historyOpen||[]).includes(old.querySelector('summary')?.textContent);
 const panel=group?.querySelector('.department-panel');
 const returnResult=panel?.querySelector('.requester-return-result');
 const handoffResult=context.action==='ACCEPT'&&q.system&&QAWorkflow.awaitingDepartmentWork(assignment);
 const rollbackNote=context.rollbackReason?group?.querySelector('.workflow-reason-note[data-action=ADMIN_ROLLBACK]'):null;
 const target=rollbackNote||(handoffResult?(group?.querySelector('.system-accept-note')||source?.querySelector('.system-accept-note')||group||source):returnResult|| (unrelated?source?.querySelector('.unrelated-routing')||group?.querySelector('.unrelated-routing'):
   q.canAccept?(group?.querySelector('.unaccepted-actions')||source?.querySelector('.unaccepted-actions')):context.action==='SAVE_DRAFT'?panel?.querySelector('.department-action-bar')||panel:panel||group||source));
 if(!target)return;
 document.querySelectorAll('.workflow-focus').forEach(n=>{n.classList.remove('workflow-focus');n.querySelector(':scope > .workflow-focus-hint')?.remove();});
 target.classList.add('workflow-focus');target.dataset.assignment=assignment.assignment_id;target.tabIndex=-1;
 const hint=document.createElement('p');hint.className='workflow-focus-hint';hint.setAttribute('role','status');
 hint.textContent=unrelated?'รอคุณพิจารณาแผนกรับผิดชอบ':review?(q.canFinalReview?'รอคุณตรวจสอบรายละเอียดและไฟล์แนบ แล้วเลือกผลตรวจด้านล่าง':'รอคุณตรวจสอบรายละเอียดและไฟล์แนบ แล้วเลือกอนุมัติหรือส่งกลับด้านล่าง'):
  q.canAccept?'รับงานของแผนก '+assignment.department_code+' ได้ที่นี่':q.canEdit?(context.action==='SAVE_DRAFT'?'บันทึกแบบร่างแล้ว — ยังไม่ได้ส่งงาน กดส่งด้านล่างเมื่อพร้อม':'กรอกข้อมูลการดำเนินงานและแนบไฟล์ได้ที่นี่'):'ผลการดำเนินการล่าสุดของแผนก '+assignment.department_code;
 if(!rollbackNote&&!returnResult&&!handoffResult)target.prepend(hint);
 target.focus?.({preventScroll:true});
 target.scrollIntoView?.({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches?'auto':'smooth',block:'start'});
}

function catalogPanel(assignment,onlyReading){
 const panel=document.createElement('section');
 panel.className='catalog-department-panel';
 const response=assignment.published_response;
 const fields=response?Object.entries({
  problem_analysis:'วิเคราะห์สาเหตุ',corrective_action:'การแก้ปัญหา',preventive_action:'การป้องกัน'
 }).filter(([key])=>String(response[key]||'').trim())
   .map(([key,title])=>'<section class="response-field-card"><b>'+esc(title)+'</b><div class="read-text">'+esc(response[key])+'</div></section>').join(''):'';
 panel.innerHTML=(onlyReading?'':'<span class="catalog-read-only">ดูอย่างเดียว</span>')+(fields
  ? (response.previous_round?'<p class="muted">คำตอบที่ส่งครั้งก่อน</p>':'')+'<div class="response-fields-grid">'+fields+'</div>'
  : '<p class="muted">ยังไม่มีคำตอบที่ส่งแล้ว</p>');
 return panel;
}
function appendCatalogUnassigned(parent,issues){
 if(!issues.length)return;
 const section=document.createElement('section');
 section.className='sheet catalog-unassigned';
 section.innerHTML='<h2>รายละเอียดที่ยังไม่ได้ระบุแผนกรับเรื่อง</h2>'+issues.map(issue=>
  '<article id="catalog-issue-'+esc(issue.issue_id)+'"><h3>'+esc(categoryName(issue.category_code,issue.category_other||'')||'รายละเอียดปัญหา')+
  '</h3><p class="expanded-issue-description">'+esc(issue.description||'')+'</p>'+
  (issue.request_due_date?'<p class="issue-request-due"><b>วันกำหนดเสร็จ:</b> '+esc(formatRequestDate(issue.request_due_date))+'</p>':'')+'</article>'
 ).join('');
 parent.append(section);
}
function detailState(state){const host=$('captureArea');if(host){host.dataset.detailState=state;host.setAttribute('aria-busy',String(state==='loading'));}const loading=$('detailLoading');if(loading)loading.hidden=state!=='loading';$('pdfButton').disabled=state!=='ready';}
const workflowReasonLabels={
 ADMIN_ROLLBACK:'เหตุผลที่ System Admin ย้อนสถานะ',
 RETURN:'เหตุผลที่หัวหน้าแผนกส่งกลับแก้ไข'
};
function assignmentReasons(rows){
 const byAssignment=new Map();
 if(!Array.isArray(rows))return byAssignment;
 for(const row of rows){
  if(!Object.hasOwn(workflowReasonLabels,row.action)||typeof row.reason!=='string'||!row.reason.trim())continue;
  const key=String(row.assignment_id);
  if(!byAssignment.has(key))byAssignment.set(key,[]);
  byAssignment.get(key).push(row);
 }
 return byAssignment;
}
function workflowReasonNote(event){
 const note=document.createElement('aside');
 note.className='workflow-reason-note';
 note.dataset.action=event.action;
 const heading=document.createElement('strong');
 heading.textContent=event.kind==='ADMIN_RETURN_TO_OWNER'?'เหตุผลที่ System Admin ส่งกลับแก้ไข':workflowReasonLabels[event.action];
 const reason=document.createElement('p');
 reason.textContent=event.reason;
 note.append(heading,reason);
 const date=new Date(event.created_at);
 if(Number.isFinite(date.getTime())){
  const time=document.createElement('time');
  time.dateTime=date.toISOString();
  time.textContent=date.toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});
  note.append(time);
 }
 return note;
}
async function render(requestedFocus={}){if(activePickers.some(p=>p.isPreparing())){setNote(QAMediaPicker.preparingMessage);return false;}if(window.QAWork&&!await QAWork.flushAll()){setNote('ยังมีคอมเมนต์ที่บันทึกไม่สำเร็จ กรุณาตรวจสอบก่อนเปลี่ยนหน้า',true);return false;}const focusContext={...captureDetailFocus(),...requestedFocus};$('requestHeaderEditor')?._dispose?.();detailState('loading');activePickers.forEach(p=>p.destroy());activePickers=[];clearTimeout(departmentHighlightTimer);if(!jobId){setNote('ไม่พบหมายเลขงาน',true);detailState('error');return false;}
 try{
 // These secured reads use the same job ID and do not depend on one another.
 // Settle every read so optional history errors cannot reject an unread promise.
 signedUrls.clear();
 previewObserver?.disconnect();
 const catalog=fromAllJobs?await rpc('qa_all_jobs_detail_v1',{p_job_id:jobId}):null;
 const catalogOnly=Boolean(catalog&&catalog.workflow_visible!==true);
 const loaded=await Promise.allSettled(catalogOnly
  ? [loadCategoryNames(),catalog,{rows:[],roundReady:false},[],[],{issues:{},assignments:{}}]
  : [loadCategoryNames(),rpc('qa_vnext_job_detail',{p_job_id:jobId}),loadMedia(),
     rpc('qa_v51_assignment_rounds',{p_job_id:jobId}),
     rpc('qa_v38_job_history',{p_job_id:jobId}),rpc('qa_workflow_notes_v1',{p_job_id:jobId}),
     rpc('qa_workflow_reasons_v1',{p_job_id:jobId})]);
 $('catalogReadOnly').hidden=!catalogOnly;
 $('pdfButton').hidden=catalogOnly;
 $('jobHistory').hidden=catalogOnly;
 for(const index of [0,1,2,5])if(loaded[index].status==='rejected')throw loaded[index].reason;
 detail=loaded[1].value;
 detail._catalogOnly=catalogOnly;
 if(QA.profile?.role==='viewer'||catalogOnly)detail.can_manage_issues=false;
 detail._workflow_history=loaded[4].status==='fulfilled'?loaded[4].value:[];
 const authorizedAssignments=catalogOnly?[]:QAWorkflow.visibleAssignments(QA.profile,detail,detail.assignments||[]);
 const ids=new Set(authorizedAssignments.map(a=>String(a.assignment_id)));
 detail.assignments=[...authorizedAssignments,...(catalog?.assignments||[])
  .filter(a=>!ids.has(String(a.assignment_id)))
  .map(a=>({...a,_catalogRead:true}))];
 media=loaded[2].value.rows;mediaRoundReady=loaded[2].value.roundReady;
 // Correction history remains supplementary and may fail independently.
 let archived=loaded[3].status==='fulfilled'?loaded[3].value:[],roundLoadWarning='';
 if(loaded[3].status==='rejected'){const error=loaded[3].reason;roundLoadWarning='โหลดประวัติการแก้ไขไม่สำเร็จ: '+(error?.message||String(error));console.warn('Correction rounds unavailable:',error);}
 completedRounds=new Map();for(const row of (Array.isArray(archived)?archived:[])){const key=String(row.assignment_id);if(!completedRounds.has(key))completedRounds.set(key,[]);completedRounds.get(key).push(row);}
 if(roundLoadWarning)setNote(roundLoadWarning,true);
 detail.assignments=(detail.assignments||[]).filter(a=>(a.issues||[]).length>0);
 if(!Array.isArray(media))media=[];
 if(detail.assignments.some(a=>QAWorkflow.permissions(QA.profile,detail,a).canResolveUnrelated)){try{const rec=await rpc('qa_vnext_receivers',{});receivingDepartments=Array.isArray(rec)?rec.map(x=>({code:String(x.department_code||x.code||''),enabled:x.enabled!==false})).filter(x=>x.code&&x.enabled):[];}catch(_e){receivingDepartments=[];}}
 const appendBtn=$('appendIssueBtn');if(appendBtn){
  appendBtn.hidden=!canAppendIssue();
  appendBtn.onclick=async()=>{if(appendBtn.disabled)return;appendBtn.disabled=true;
   try{await openRequestHeaderEditor(true);}catch(error){setNote('เปิดฟอร์มเพิ่มปัญหาไม่ได้: '+requestEditError(error),true);}
   finally{appendBtn.disabled=false;}};
 }
 const editBtn=$('editRequestBtn');if(editBtn){editBtn.hidden=!detail.can_manage_issues;editBtn.textContent='แก้ไขใบแจ้ง';editBtn.onclick=async()=>{if(editBtn.disabled)return;editBtn.disabled=true;try{await openRequestHeaderEditor();}catch(e){setNote('เปิดแก้ไขใบแจ้งไม่ได้: '+requestEditError(e),true);}finally{editBtn.disabled=false;}};}

 if(!catalogOnly){
 const pendingLine=sessionStorage.getItem('qa-v49-pending-line:'+jobId);if(pendingLine){try{receiverChangeRetryButton(JSON.parse(pendingLine));}catch(_e){sessionStorage.removeItem('qa-v49-pending-line:'+jobId);}}
 const warning=sessionStorage.getItem('qa-v38-line-warning:'+jobId);if(warning){setNote('บันทึกใบงานแล้ว แต่แจ้งเตือน LINE ไม่สำเร็จ: '+warning,true);sessionStorage.removeItem('qa-v38-line-warning:'+jobId);}
 if(sessionStorage.getItem('qa-full-edit-lines:'+jobId))requestLineRetry();
 }
 $('details').innerHTML=`<dl class="record-facts"><div><dt>Serial Number</dt><dd>${esc(detail.serial_no||'-')}</dd></div><div><dt>ลูกค้า</dt><dd>${esc(detail.customer_name||'-')}</dd></div><div><dt>ประเทศ</dt><dd>${esc(detail.country||'-')}</dd></div></dl>${String(detail.requester_remark||'').trim()?'<p class="record-remark"><b>Remark:</b> '+esc(detail.requester_remark)+'</p>':''}`;
 const list=$('assignments');list.replaceChildren();
 const unassigned=catalog?.unassigned_issues||[];
 if(!detail.assignments?.length){
 if(unassigned.length){appendCatalogUnassigned(list,unassigned);renderTracker(detail);detailState('ready');return true;}
 list.innerHTML='<section class="sheet">ใบงานนี้ยังไม่มีรายละเอียดฝ่ายรับเรื่อง</section>';if(!catalogOnly)QAWork.emptyForwarded(list,loaded[4].status==='fulfilled'?loaded[4].value:[],media,getUrl);renderTracker(detail);if(list.dataset.forwardedEmpty==='true')document.querySelectorAll('.tracker-stages [data-step]').forEach(n=>{n.classList.remove('current','done');n.removeAttribute('aria-current');});detailState('ready');return true;}
 // Section 2 is one permanent container. Every issue remains visible in order.
 const issueSheet=document.createElement('section');issueSheet.className='sheet issues-section';issueSheet.id='allIssues';
 issueSheet.innerHTML='<h2>รายละเอียด</h2><div id="allIssueCards"></div>';
 list.append(issueSheet);
 const issueHost=issueSheet.querySelector('#allIssueCards');
 // Shared issue number: multiple departments must show exactly the same code.
 const issueCodeFor=(a,i)=>String(detail.car_code||detail.job_id)+'-'+String(i.issue_number||1).padStart(2,'0');
 const displayedIssues=new Set();
 for(const a of detail.assignments){
  const deptGroup=document.createElement('div');deptGroup.className='issue-department-group';
  deptGroup.dataset.departmentCode=a.department_code;
  deptGroup.dataset.assignment=a.assignment_id;
  deptGroup.id='issue-dept-'+encodeURIComponent(a.assignment_id);
  const issueItems=[...(a.issues||[])].sort((x,y)=>Number(x.issue_number)-Number(y.issue_number));
  const cards=[];
  for(const i of issueItems){
   // An issue can be assigned to multiple departments. Show it in each department group,
   // so the flow button consistently takes the user to that department's issues.
   const uniqueKey=String(a.assignment_id)+':'+String(i.issue_id);
   if(displayedIssues.has(uniqueKey))continue;
   displayedIssues.add(uniqueKey);

   // The detail view is read-only for issuer data; edit through openRequestHeaderEditor().
   if(a._catalogRead)continue;
   cards.push(`<article class="issue issue-card" id="issue-${esc(i.issue_id)}-${esc(a.assignment_id)}" data-issue-id="${esc(i.issue_id)}"><h3><span class="issue-code">${esc(issueCodeFor(a,i))}</span> · ปัญหา ${esc(i.issue_number)} <span class="issue-category">${esc(categoryName(i.category_code,i.category_other||''))}</span></h3><p><b>รายละเอียดปัญหา :</b> ${esc(i.description)}</p>${media.some(m=>m.scope==='ISSUE'&&m.issue_id===i.issue_id)?'<b>ไฟล์แนบจากผู้แจ้ง</b>':''}${mediaFor([i.issue_id],null,false)}</article>`);
  }
  if(a._catalogRead)deptGroup.append(catalogPanel(a,catalogOnly));
  else deptGroup.innerHTML=`<h3 class="issue-dept-title">แผนก ${esc(a.department_code||'-')}</h3>${cards.join('')||'<p class="muted">ไม่มีรายการปัญหาสำหรับแผนกนี้</p>'}`;
  issueHost.append(deptGroup);
 }
 // Keep each response beside its own assignment issues; never guess a per-issue mapping.
 for(const a of authorizedAssignments.filter(a=>a.issues?.length)){
 const rights=QAWorkflow.permissions(QA.profile,detail,a,{hasResponseFiles:media.some(m=>m.scope==='ASSIGNMENT'&&m.assignment_id===a.assignment_id)});
 const mine=rights.own||rights.system;
 const isRequester=detail.is_requester||QA.profile?.role==='system_admin';
 // Department heads of the reporting department are the only intended final reviewers.
 const isFinalReviewer=!a.self_response&&rights.canFinalReview;
 const el=document.createElement('section');el.className='sheet department-panel';
 el.dataset.assignment=a.assignment_id;el.dataset.departmentCode=a.department_code;
 const isResponsible=String(a.responsible_user||'')===String(QA.profile?.user_id||'');
 const responseEditable=a.self_response?canSelfRespond()&&isResponsible&&a.status==='IN_PROGRESS':rights.canEdit;
 const pendingHeadReview=a.status==='IN_PROGRESS'&&Boolean(a.approval_requested_at);
 const showResponse=!QAWorkflow.awaitingDepartmentWork(a)&&(a.status!=='OPEN'||Boolean(a.responsible_user||a.accepted_at));
 // A requester should not see an empty Section 3 before the receiving department accepts.
 // Keep it available for the receiving department (including its acceptance controls).
 if(detail.is_requester && !mine && !showResponse && !rights.canResolveUnrelated && !QAWorkflow.awaitingDepartmentWork(a))continue;
 const priorRounds=(completedRounds.get(String(a.assignment_id))||[]).slice().sort((x,y)=>Number(x.round_no)-Number(y.round_no));
 const roundNumber=(priorRounds.length?Math.max(...priorRounds.map(r=>Number(r.round_no)||0)):0)+1;
 // A previously rejected job without a saved archive is NOT safe to edit: its old text
 // may still reside in the current assignment. Preserve it until audited repair SQL runs.
 const hasLegacyUnarchivedFailure=!a.self_response&&a.status==='IN_PROGRESS'&&!!String(a.requester_review_reason||'').trim()&&!a.approval_requested_at&&priorRounds.length===0;
 a._legacyLocked=hasLegacyUnarchivedFailure;
 const canEditCurrent=responseEditable&&!hasLegacyUnarchivedFailure&&!(priorRounds.length&&!mediaRoundReady);
 const afterRejection=priorRounds.length>0&&a.status==='IN_PROGRESS'&&!a.approval_requested_at;
 const hasCurrentResponse=['receiver_problem_detail','problem_analysis','corrective_action','preventive_action'].some(k=>String(a[k]||'').trim())||media.some(m=>m.scope==='ASSIGNMENT'&&m.assignment_id===a.assignment_id&&Number(m.response_round||1)===roundNumber);
 const hideEmptyRework=afterRejection&&!canEditCurrent&&!hasCurrentResponse;
 const rejectedReason=String(a.requester_review_reason||priorRounds[priorRounds.length-1]?.rejection_reason||'').trim();
 const earlier=priorRounds.map(r=>`<section class="response-prior-round"><h3>บันทึกการแก้ไขครั้งที่ ${esc(r.round_no)} (อ่านอย่างเดียว)</h3><p class="muted">เหตุผลที่ส่งกลับ: ${esc(r.rejection_reason||'-')}</p><p><b>รายละเอียดปัญหา/ข้อบกพร่อง:</b> ${esc(r.receiver_problem_detail||'-')}</p><p><b>วิเคราะห์สาเหตุ:</b> ${esc(r.problem_analysis||'-')}</p><p><b>การแก้ปัญหา:</b> ${esc(r.corrective_action||'-')}</p><p><b>การป้องกัน:</b> ${esc(r.preventive_action||'-')}</p><p><b>กำหนดเสร็จ:</b> ${esc(r.due_date||'-')}</p><h3>ไฟล์แนบการแก้ไขรอบนี้</h3>${mediaRoundReady?mediaFor([],a.assignment_id,false,Number(r.round_no)):'<p class="muted">ต้องอัปเดตส่วนแยกรอบไฟล์แนบใน Supabase ก่อนแสดงประวัติไฟล์</p>'}</section>`).join('');
 const oldDataNotice=hasLegacyUnarchivedFailure?'<div class="rework-unarchived">รายการนี้เคยตรวจรับไม่ผ่านก่อนที่ระบบบันทึกรอบจะพร้อม ข้อมูลการแก้ไขเดิมถูกล็อกเพื่อไม่ให้เขียนทับ กรุณาตรวจสอบและรัน SQL ซ่อมประวัติงานค้างเดิมก่อนเริ่มการแก้ไขครั้งที่ 2</div>':'';
 // Files attached in earlier rounds are view-only on rework; historical text is immutable in the DB.
 const systemAcceptNote=String(a.system_accept_comment||'').trim();
 const systemAcceptHtml=systemAcceptNote?'<aside class="system-accept-note"><h3>หมายเหตุจาก System Admin (รับงานแทน)</h3><p>'+esc(systemAcceptNote)+'</p></aside>':'';
 const responseMedia=showResponse?(priorRounds.length&&!mediaRoundReady?'<p class="action-note">ยังแยกไฟล์แนบตามรอบไม่ได้ ต้องติดตั้งส่วน Supabase ให้ครบก่อนเริ่มรอบใหม่</p>':mediaFor([],a.assignment_id,canEditCurrent&&!a.self_response,roundNumber)):'';
 const issueNumbers=(a.issues||[]).map(i=>String(i.issue_number)).join(', ');
 const sharedResponse=(a.issues||[]).length>1;
 el.innerHTML=`<h3 class="response-title">การดำเนินงาน — ${esc(assignmentName(a))} · ปัญหา ${esc(issueNumbers)} <span class="badge">${esc(assignmentStatus(a))}</span></h3>${sharedResponse&&showResponse?'<p class="shared-response-note">คำตอบรวมของแผนกสำหรับปัญหา '+esc(issueNumbers)+' · คำตอบนี้ใช้ร่วมกันทุกข้อที่ระบุ</p>':''}
 ${systemAcceptHtml}
 ${showResponse?(hideEmptyRework?`${earlier}${oldDataNotice}<p class="requester-return-result" role="status"><strong>ตรวจสอบไม่ผ่าน — ส่งกลับแก้ไข</strong><span>${esc(rejectedReason||'รอแผนกดำเนินการแก้ไข')}</span></p><div class="no-print actions"></div>`:`${earlier}${oldDataNotice}${priorRounds.length?'<h3>รายละเอียดการแก้ไขครั้งที่ '+roundNumber+'</h3>':''}${afterRejection?'<p class="rework-reminder">ส่งกลับแก้ไข · ตรวจคำตอบและส่งตรวจอีกครั้งเมื่อแก้ไขเสร็จ</p>':''}<p class="response-responsible"><b>ผู้รับผิดชอบ:</b> ${esc(a.responsible_name||a.responsible_user||'ยังไม่รับงาน')}</p>
 ${!detail.request_due_date&&a.due_date?`<p class="response-due-row"><b>กำหนดเสร็จ:</b> ${esc(formatRequestDate(a.due_date))}</p>`:''}
 <div class="response-fields-grid"><label class="field response-field-card" data-field-step="1">รายละเอียดปัญหา/ข้อบกพร่อง<textarea class="recv" ${!canEditCurrent?'disabled':''}>${esc(a.receiver_problem_detail||'')}</textarea></label>
 <label class="field response-field-card" data-field-step="2">วิเคราะห์สาเหตุ<textarea class="analysis" ${!canEditCurrent?'disabled':''}>${esc(a.problem_analysis||'')}</textarea></label>
 <label class="field response-field-card" data-field-step="3">การแก้ปัญหา<textarea class="fix" ${!canEditCurrent?'disabled':''}>${esc(a.corrective_action||'')}</textarea></label>
 <label class="field response-field-card" data-field-step="4">การป้องกัน<textarea class="prevent" ${!canEditCurrent?'disabled':''}>${esc(a.preventive_action||'')}</textarea></label></div>
 ${responseMedia?'<h3>ไฟล์แนบฝ่ายรับเรื่อง</h3>':''}<div class="current-response-media" ${responseMedia?'':'hidden'}>${responseMedia}</div>
 
 ${canEditCurrent&&!a.self_response?'<div class="response-picker no-print"></div><p class="response-draft-state no-print" role="status" aria-live="polite"></p>':''}
 <div class="no-print actions"></div>
 ${a.self_response?(a.requester_review_reason?'<p class="qa-self-response-reason"><b>เหตุผลที่ส่งกลับ:</b> '+esc(a.requester_review_reason)+'</p>':''):responseStatus(a,rights.canReopenResponse)}`) : ''}${!showResponse?'<p class="operation-waiting">รอการรับเรื่อง/ดำเนินงาน</p><div class="no-print actions"></div>':''}`;
 if(a.unrelated_requested_at&&a.status!=='CANCELLED'){const note=document.createElement('p');note.className='shared-response-note';note.textContent='รอพิจารณาฝ่ายรับเรื่อง: '+(a.unrelated_reason||'แจ้งว่าไม่เกี่ยวข้อง');el.prepend(note);}
 const actions=el.querySelector('.actions');
 function btn(text,action,color='secondary'){const b=document.createElement('button');b.textContent=text;b.className=color;b.onclick=()=>act(a,action,el);actions.append(b);}
 if(a.self_response){
  const issueId=a.issues[0].issue_id;
  const selfButton=(text,action,values)=>{
   const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=text;
   b.onclick=()=>{const data=values?.();if(data!==false)void selfAction(issueId,action,b,a,data);};
   actions.append(b);
  };
  if(canEditCurrent)selfButton(QA.profile.role==='department_admin'?'บันทึกคำตอบ':'ส่งให้หัวหน้าตรวจ','SUBMIT',()=>{
   const inputs={problem_analysis:el.querySelector('.analysis'),corrective_action:el.querySelector('.fix'),preventive_action:el.querySelector('.prevent')};
   for(const input of Object.values(inputs))if(!input.value.trim()){setNote('กรอกคำตอบให้ครบทั้งสามช่อง',true);input.focus();return false;}
   return Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]));
  });
  if(QA.profile.role==='department_admin'&&QA.profile.department===a.department_code&&!isResponsible&&pendingHeadReview){
   selfButton('อนุมัติคำตอบ','APPROVE');
   selfButton('ส่งกลับแก้ไข','RETURN',()=>{
    let input=el.querySelector('.qa-self-return');
    if(!input){const field=document.createElement('label');field.className='field';field.textContent='เหตุผลที่ส่งกลับ';input=document.createElement('textarea');input.className='qa-self-return';input.maxLength=2000;field.append(input);actions.before(field);input.focus();return false;}
    if(!input.value.trim()){setNote('กรุณาระบุเหตุผลที่ส่งกลับ',true);input.focus();return false;}
    return {reason:input.value.trim()};
   });
  }
 }else{
 if(rights.canAccept)btn('รับงาน','ACCEPT');
 if(canEditCurrent){btn('บันทึกแบบร่าง','SAVE_DRAFT');if(rights.canHeadSend)btn('ส่งงาน','HEAD_SEND');if(rights.canRequestApproval)btn('ส่งให้หัวหน้าตรวจสอบ','REQUEST_APPROVAL');}
 if(rights.canReopenResponse)btn('แก้ไขรายละเอียด','REOPEN_RESPONSE');
 if(rights.canApprove){btn('อนุมัติและส่งงาน','APPROVE');btn('ส่งกลับให้แก้ไข','RETURN','danger');}
 if(isFinalReviewer){btn('ผ่าน','REQUESTER_PASS');btn('ไม่ผ่าน','REQUESTER_FAIL','danger');}
 // Direct forwarding replaces new unrelated-return requests. Existing pending cases remain resolvable.
 if(rights.canResolveUnrelated){
  const routing=document.createElement('div');routing.className='unrelated-routing no-print';
  routing.innerHTML='<h3>พิจารณาแผนกรับผิดชอบ</h3><div class="unrelated-choices"><label><input type="radio" name="unrelated-'+esc(a.assignment_id)+'" value="change"> เปลี่ยนแผนก</label><label><input type="radio" name="unrelated-'+esc(a.assignment_id)+'" value="cancel"> ยกเลิกงานแผนกนี้</label></div><div class="unrelated-target-fields" hidden><label>ปัญหาที่ต้องการเปลี่ยน<select class="unrelated-issue">'+a.issues.map(i=>'<option value="'+esc(i.issue_id)+'">ปัญหา '+esc(i.issue_number)+' · '+esc(i.description)+'</option>').join('')+'</select></label><label>ฝ่ายรับเรื่องใหม่<select class="unrelated-target"><option value="">เลือกแผนกใหม่</option>'+receivingDepartments.filter(d=>d.code!==a.department_code).map(d=>'<option value="'+esc(d.code)+'">'+esc(d.code)+'</option>').join('')+'</select></label></div>';
  for(const input of routing.querySelectorAll('input[type=radio]'))input.onchange=()=>{routing.querySelector('.unrelated-target-fields').hidden=input.value!=='change';};
  const confirmButton=document.createElement('button');confirmButton.type='button';confirmButton.textContent='ยืนยัน';confirmButton.onclick=()=>{const choice=routing.querySelector('input[type=radio]:checked')?.value;if(!choice){setNote('เลือกเปลี่ยนแผนกหรือยกเลิกงานแผนกนี้ก่อนยืนยัน',true);return;}if(choice==='change')resolveUnrelatedReceiver(a,routing,confirmButton);else act(a,'UNRELATED_CONFIRM',el);};routing.append(confirmButton);el.append(routing);
 }
 }
 if(rights.system&&a.responsible_user&&!a.unrelated_requested_at&&
    ['IN_PROGRESS','WAITING_REVIEW','CLOSED'].includes(a.status)&&!(a.status==='IN_PROGRESS'&&a.needs_rework&&!a.approval_requested_at)){
  const button=document.createElement('button');
  button.type='button';
  button.className='danger admin-return-to-owner';
  button.textContent='ส่งกลับให้ผู้รับผิดชอบแก้ไข';
  button.onclick=()=>adminReturnToOwner(a,button);
  actions.append(button);
 }
 for(const btnNote of el.querySelectorAll('.media-note-save'))btnNote.addEventListener('click',async()=>{
  const input=[...el.querySelectorAll('.media-note-input')].find(x=>x.dataset.attachment===btnNote.dataset.attachment);
  if(!input)return;btnNote.disabled=true;try{await rpc('qa_v38_media_set_note',{p_attachment_id:btnNote.dataset.attachment,p_note:input.value});setNote('บันทึกหมายเหตุเรียบร้อย');}catch(e){setNote('บันทึกหมายเหตุไม่สำเร็จ: '+e.message,true)}finally{btnNote.disabled=false}
 });
 if(canEditCurrent&&!a.self_response){
  const key=String(a.assignment_id)+':'+roundNumber;el.dataset.queueKey=key;
  if(!responseQueues.has(key))responseQueues.set(key,[]);
  const entries=responseQueues.get(key),registeredIds=new Set(media.map(m=>String(m.attachment_id)));
  for(let i=entries.length-1;i>=0;i--)if(entries[i].attachmentId&&registeredIds.has(String(entries[i].attachmentId))&&entries[i].savedNote===(entries[i].note||''))entries.splice(i,1);
  const saved=responseDrafts.get(key);if(saved&&saved.version===a.version)for(const [selector,value] of Object.entries(saved.values))el.querySelector(selector).value=value;
  const state=el.querySelector('.response-draft-state');const sendTarget=rights.canHeadSend?'ส่งงาน':'ส่งให้หัวหน้าตรวจสอบ';
  const dirty=()=>{responseDrafts.set(key,{version:a.version,values:Object.fromEntries(['.recv','.analysis','.fix','.prevent'].map(q=>[q,el.querySelector(q).value]))});state.textContent='มีการแก้ไขที่ยังไม่ได้บันทึกแบบร่าง และยังไม่ได้'+sendTarget;state.dataset.state='unsaved';const empty=el.querySelector('.current-response-media > p.muted');if(empty)empty.hidden=entries.length>0;};
  const persisted=['receiver_problem_detail','problem_analysis','corrective_action','preventive_action','due_date'].some(k=>String(a[k]||'').trim())||media.some(m=>m.scope==='ASSIGNMENT'&&m.assignment_id===a.assignment_id&&Number(m.response_round||1)===roundNumber);
  state.textContent=persisted?'บันทึกแบบร่างแล้ว — ยังไม่ได้'+sendTarget:'ยังไม่มีแบบร่างที่บันทึก — กรอกข้อมูลแล้วกดบันทึกแบบร่าง หรือ'+sendTarget+'ได้เลย';state.dataset.state=persisted?'draft':'empty';
  for(const field of el.querySelectorAll('.recv,.analysis,.fix,.prevent'))field.addEventListener('input',dirty);
  const currentFiles=media.filter(m=>m.scope==='ASSIGNMENT'&&m.assignment_id===a.assignment_id&&Number(m.response_round||1)===roundNumber);
  activePickers.push(QAMediaPicker.mount(el.querySelector('.response-picker'),{entries,existing:()=>({images:currentFiles.filter(m=>m.kind==='IMAGE').length,videos:currentFiles.filter(m=>m.kind==='VIDEO').length}),onChange:()=>{dirty();if($('feedback').textContent===QAMediaPicker.preparingMessage&&!activePickers.some(p=>p.isPreparing()))setNote('');},onError:message=>setNote(message,true)}));
  if(saved&&saved.version===a.version||entries.length)dirty();
 }
 if(!canEditCurrent){for(const sel of ['.recv','.analysis','.fix','.prevent']){const textarea=el.querySelector(sel);if(!textarea)continue;const plain=document.createElement('div');plain.className='read-text';plain.textContent=textarea.value||'-';textarea.replaceWith(plain)}}
 const group=[...issueHost.querySelectorAll('.issue-department-group')].find(g=>g.dataset.assignment===String(a.assignment_id));
 // A single-issue assignment has an unambiguous mapping. A multi-issue
 // assignment retains one clearly labelled shared response instead of duplicating it.
 const responseHost=group&&((a.issues||[]).length===1?group.querySelector('.issue-card'):group);
 (responseHost||issueHost).append(el);
 if(actions.children.length){const outside=document.createElement('div');outside.className='department-action-bar no-print';outside.dataset.assignment=a.assignment_id;outside.append(...Array.from(actions.childNodes));actions.remove();el.append(outside);}
 }
 const reasons=assignmentReasons(loaded[6]?.status==='fulfilled'?loaded[6].value:[]);
 organizeDetailPanels(issueSheet,issueHost,focusContext.departmentOpen,reasons);
 appendCatalogUnassigned(list,unassigned);
 if(!catalogOnly)QAWork.mount({detail,jobId,notes:loaded[5].value,history:loaded[4].status==='fulfilled'?loaded[4].value:[],root:issueSheet,media,getUrl,rpc,note:setNote,render,queueEvents:queueRequestEvents,sendEvents:sendRequestLines,complete:returnHome,saveDraft:async(a,panel)=>{if(activePickers.some(p=>p.isPreparing()))throw Error(QAMediaPicker.preparingMessage);const values={receiver_problem_detail:a.receiver_problem_detail||'',problem_analysis:panel.querySelector('.analysis').value,corrective_action:panel.querySelector('.fix').value,preventive_action:panel.querySelector('.prevent').value};const r=await rpc('qa_vnext_assignment_action',{p_assignment_id:a.assignment_id,p_action:'SAVE_DRAFT',p_expected_version:a.version,p_data:values});a.version=Number(r.version);Object.assign(a,values);await uploadResponse(a.assignment_id,responseQueues.get(panel.dataset.queueKey)||[]);responseDrafts.delete(panel.dataset.queueKey);responseQueues.delete(panel.dataset.queueKey);}});renderTracker(detail);
 if(!catalogOnly)await renderHistory(loaded[4]);
 detailState('ready');
 const browseIssue=fromAllJobs&&!requestedFocus.action&&QAStatus.issueFromHash(location.hash);
 if(browseIssue){
  const fold=[...issueHost.children].find(node=>node.dataset.issueId===browseIssue);
  fold?._openIssue();
 }else if(!catalogOnly)guideDetail(focusContext);
 return true;
 }catch(e){const message=fromAllJobs&&['PGRST202','42883'].includes(String(e.code||''))?'กรุณาติดตั้ง SQL ชุดเปิดดูงานทั้งหมด':e.message;setNote('อ่านใบงานไม่สำเร็จ: '+message,true);$('details').textContent='โปรดตรวจสิทธิ์ หรือกลับไปเปิดใบงานเดิม';$('assignments').replaceChildren();detailState('error');return false;}}
// Each issue is one collapsed list row. Move bound assignment forms between
// issue folds so a shared response has exactly one live editor and one version.
function organizeDetailPanels(issueSheet,issueHost,openDepartments=[],reasons=new Map()){
 const compactAdmin=String(QA.profile?.role||'').toLowerCase()==='system_admin';
 const assignments=detail.assignments||[],issues=new Map(),groups=new Map(),sourceCards=new Map();
 for(const a of assignments)for(const i of a.issues||[]){const key=String(i.issue_id);if(!issues.has(key))issues.set(key,{issue:i,assignments:[]});issues.get(key).assignments.push(a);}
 const department=String(QA.profile?.department||'').trim().toLowerCase();
 const foldDepartments=compactAdmin||detail.is_requester||assignments.some(a=>a._catalogRead)||(
  department&&['user','department_admin'].includes(QA.profile.role)&&
  department===String(detail.from_department||'').trim().toLowerCase()
 );
 const openSet=new Set(openDepartments);
 const storage=document.createElement('div');storage.className='issue-response-storage';storage.hidden=true;
 const cardBank=document.createElement('div'),panelBank=document.createElement('div');storage.append(cardBank,panelBank);
 const attention=a=>{const text=a.self_response?'':QAWorkflow.reviewAttention(QA.profile,detail,a);return text?'<span class="review-attention"><span aria-hidden="true">●</span> '+esc(text)+'</span>':'';};
 const badge=a=>attention(a)+'<span class="issue-status '+esc(QAStatus.canonical(a.status))+'">'+esc(assignmentStatus(a))+'</span>';
 for(const original of [...issueHost.querySelectorAll('.issue-department-group')]){
  const a=assignments.find(x=>String(x.assignment_id)===original.dataset.assignment);if(!a)continue;
  const panel=original.querySelector('.department-panel,.catalog-department-panel');if(panel)panel.remove();
  for(const card of [...original.querySelectorAll('.issue-card')]){card.querySelector(':scope>h3')?.remove();for(const p of card.querySelectorAll(':scope>p:not(.muted)'))p.remove();if(compactAdmin){card.dataset.referenceCode=card.querySelector('.issue-code')?.textContent||'';card.classList.add('admin-source-card');for(const n of [...card.children])if(n.matches('h3,p:not(.muted)'))n.remove();}
   sourceCards.set(String(a.assignment_id)+':'+card.dataset.issueId,card);cardBank.append(card);}
  const group=document.createElement('section');group.className='issue-department-group issue-operation-group'+(compactAdmin?' admin-operation-group':'');group.id=original.id;group.dataset.assignment=a.assignment_id;group.dataset.departmentCode=a.department_code;
  group.innerHTML='<div class="operation-department-heading"><strong>'+esc(assignmentName(a))+'</strong>'+badge(a)+'</div>';
  for(const event of reasons.get(String(a.assignment_id))||[]){
   if(event.action==='RETURN'&&a.self_response&&a.requester_review_reason===event.reason)continue;
   group.append(workflowReasonNote(event));
  }
  const accepted=!QAWorkflow.awaitingDepartmentWork(a)&&(Boolean(a.accepted_at||a.responsible_user)||['IN_PROGRESS','WAITING_REVIEW','CLOSED'].includes(a.status)),q=QAWorkflow.permissions(QA.profile,detail,a);
  const sources=document.createElement('div');sources.hidden=true;sources.className='received-issues';sources.dataset.filterAssignment=String(a.assignment_id);sources.innerHTML='<div class="source-issue-holder"></div>';
  if(a._catalogRead){group.append(sources,panel);}
  else if(!accepted){
   const dept=document.createElement('strong');dept.className='source-department-label';dept.textContent=a.department_code;group._sourceDepartmentLabel=dept;group.append(sources);
   if(panel){panel.querySelector('.response-title')?.remove();panel.querySelectorAll('.operation-waiting').forEach(n=>n.remove());panel.className='unaccepted-actions';if(panel.querySelector('button,.system-accept-note'))group.append(panel);}
  }else if(panel){panel.querySelector('.response-title')?.remove();group.append(sources,panel);}else group.append(sources);
  group._sourceDisclosure=sources;group._sourceParent=sources.parentElement;group._accepted=accepted;
  groups.set(String(a.assignment_id),group);panelBank.append(group);
 }
 issueHost.replaceChildren();issueSheet.append(storage);
 const count=document.createElement('p');count.className='section-count';count.textContent=issues.size+' ปัญหา · '+assignments.length+' แผนก';issueSheet.querySelector('h2').after(count);
 let activeIssue=null;const folds=[];
 for(const {issue:i,assignments:related} of [...issues.values()].sort((a,b)=>Number(a.issue.issue_number)-Number(b.issue.issue_number))){
  const fold=document.createElement('details');fold.className='issue-disclosure'+(compactAdmin?' admin-compact-issue':'');fold.dataset.issueId=String(i.issue_id);fold.dataset.assignmentIds=related.map(a=>String(a.assignment_id)).join(',');
  fold.innerHTML='<summary aria-label="ปัญหา '+esc(i.issue_number)+': '+esc(i.description)+'"><span class="issue-row-number">'+esc(i.issue_number)+'.</span><span class="issue-row-description" title="'+esc(i.description)+'">'+esc(categoryName(i.category_code,i.category_other||''))+(window.QAIssueClassification?.badge(i.severity_code)||'')+'</span><span class="issue-row-departments">'+related.map(a=>'<span class="issue-department-state" data-filter-assignment="'+esc(a.assignment_id)+'"><span class="issue-responsible-department">'+esc(assignmentName(a))+'</span>'+badge(a)+'</span>').join('')+'</span><span class="issue-row-chevron" aria-hidden="true"></span></summary>';
  // A deadline is shared by all receiving departments for this issue only.
  const requesterDue=i.request_due_date||detail.request_due_date;
  const deadlineMarkup=requesterDue?'<p class="issue-request-due"><b>วันกำหนดเสร็จ:</b> <time datetime="'+esc(requesterDue)+'">'+esc(formatRequestDate(requesterDue))+'</time></p>':'';
  const body=document.createElement('div');body.className='issue-disclosure-body';body.innerHTML=deadlineMarkup+'<div class="issue-source-before-work"></div><div class="admin-department-list"></div><h3 class="issue-operations-title" hidden></h3><div class="issue-operation-host" hidden></div>';fold.append(body);
  const classification=window.QAIssueClassification;
  const severity=classification?.levels[i.severity_code];
  const occurrence=classification?.occurrences[i.occurrence_type];
  if(severity||occurrence){
   const facts=document.createElement('p');facts.className='qa-issue-detail-classification';
   if(severity)facts.append('กำหนดตามระดับ '+severity.deadline);
   if(occurrence)facts.append(occurrence.name);
   body.prepend(facts);
  }
  const local=related.find(a=>a.department_code===detail.from_department);
  if(canSelfRespond()&&!related.some(a=>a.self_response)&&related.some(a=>['OPEN','IN_PROGRESS','WAITING_REVIEW'].includes(a.status))
     &&(!local||local.status==='OPEN'&&!local.responsible_user&&!local.unrelated_requested_at)){
   const b=document.createElement('button');b.type='button';b.className='secondary no-print';
   b.textContent='ตอบปัญหาเอง';b.onclick=()=>selfAction(i.issue_id,'START',b);
   body.querySelector('.issue-source-before-work').before(b);
  }
  if(detail._catalogOnly){
   const description=document.createElement('p');description.className='expanded-issue-description';
   description.textContent=i.description||'';body.prepend(description);
  }
  const departmentFolds=new Map();
  if(foldDepartments&&related.length>1){
   const departmentsHost=body.querySelector('.admin-department-list');
   for(const a of related){
    const departmentFold=document.createElement('details');
    departmentFold.className='department-disclosure';
    departmentFold.dataset.filterAssignment=String(a.assignment_id);
    departmentFold.dataset.departmentFold=String(i.issue_id)+':'+String(a.assignment_id);
    departmentFold.open=openSet.has(departmentFold.dataset.departmentFold);
    const summary=document.createElement('summary');
    summary.innerHTML='<strong>'+esc(assignmentName(a))+'</strong>'+badge(a);
    departmentFold.append(summary);
    departmentsHost.append(departmentFold);
    departmentFolds.set(String(a.assignment_id),departmentFold);
   }
  }
  const mount=()=>{
   if(activeIssue===fold)return;
   for(const other of folds)if(other!==fold)other.open=false;
   for(const files of issueSheet.querySelectorAll('.live-source-attachments')){for(const card of [...files.querySelectorAll(':scope>.issue-card')])cardBank.append(card);files.hidden=true;}
   // Return the previous issue's controls to storage before attaching this issue.
   for(const group of groups.values()){
    for(const card of [...group._sourceDisclosure.querySelectorAll('.source-issue-holder > .issue-card')])cardBank.append(card);
    const sources=group._sourceDisclosure;group._sourceParent.prepend(sources);if(sources?.tagName==='DETAILS')sources.open=false;panelBank.append(group);
   }
   const host=body.querySelector('.issue-operation-host');
   for(const a of related){const group=groups.get(String(a.assignment_id));if(!group)continue;const card=sourceCards.get(String(a.assignment_id)+':'+String(i.issue_id));if(card){if(compactAdmin){const duplicate=related.indexOf(a)>0;for(const n of card.children)if(n.matches('b,.media,.muted'))n.hidden=duplicate;group._sourceDisclosure.hidden=true;group.querySelector('.operation-department-heading').hidden=related.length===1;card.classList.toggle('admin-duplicate-source',duplicate);}
   group._sourceDisclosure.querySelector('.source-issue-holder').append(card);}group.classList.toggle('admin-department-frame',compactAdmin&&related.length>1);const departmentFold=departmentFolds.get(String(a.assignment_id));if(departmentFold){departmentFold.append(group);}else if(!group._accepted)body.querySelector('.issue-source-before-work').append(group);else host.append(group);}
   const files=body.querySelector('.live-source-attachments');const first=related.length?sourceCards.get(String(related[0].assignment_id)+':'+String(i.issue_id)):null;if(files&&first&&first.querySelector('.media')){files.append(first);files.hidden=false;}for(const a of related){const group=groups.get(String(a.assignment_id));if(group){const legacyDue=group.querySelector('.response-due-row');if(legacyDue)legacyDue.hidden=Boolean(requesterDue);group._sourceDisclosure.hidden=true;group.classList.toggle('live-single-department',related.length===1);group.querySelector('.operation-department-heading').hidden=related.length===1||departmentFolds.has(String(a.assignment_id));}}
   const hasOperations=host.children.length>0;host.hidden=!hasOperations;body.querySelector('.issue-operations-title').hidden=true;
   activeIssue=fold;
  };
  fold._openIssue=()=>{mount();fold.open=true;observePreviews(fold);};
  fold.addEventListener('toggle',()=>{if(fold.open){mount();observePreviews(fold);}});
  // Mounted on demand; guideDetail opens the relevant fold after render is ready.
  folds.push(fold);issueHost.append(fold);
 }
 // Old correction rounds stay inside their assignment and start collapsed too.
 for(const prior of issueSheet.querySelectorAll('.response-prior-round')){const fold=document.createElement('details');fold.className='prior-round-disclosure';const title=prior.querySelector('h3'),summary=document.createElement('summary');summary.textContent=title?.textContent||'ประวัติการแก้ไข';title?.remove();fold.append(summary);prior.replaceWith(fold);fold.append(prior);}
 const history=$('jobHistory');if(history&&!history.querySelector('details')){const fold=document.createElement('details'),summary=document.createElement('summary');summary.textContent='ประวัติการดำเนินงาน';history.querySelector('h2')?.remove();fold.append(summary,$('historyRows'));history.append(fold);}
}
async function renderHistory(result){
 const box=$('historyRows');box.replaceChildren();try{if(result.status==='rejected')throw result.reason;const events=result.value;
 const names={ACCEPT:'รับงาน',SAVE_DRAFT:'บันทึกการดำเนินการ',REOPEN_RESPONSE:'เปิดแก้ไขก่อนตรวจรับ',REQUEST_APPROVAL:'ส่งให้หัวหน้าอนุมัติ',HEAD_SEND:'หัวหน้าแผนกส่งงานโดยตรง',APPROVE:'หัวหน้าอนุมัติ',RETURN:'หัวหน้าไม่อนุมัติ',REQUESTER_PASS:'ผู้แจ้งตรวจรับผ่าน',REQUESTER_FAIL:'ผู้แจ้งไม่ผ่านการตรวจรับ',ADMIN_ROLLBACK:'System Admin ย้อนสถานะ',UNRELATED_REQUEST:'แจ้งไม่เกี่ยวข้อง',UNRELATED_CONFIRM:'ผู้แจ้งยืนยันถอดแผนก',UNRELATED_REJECT:'ผู้แจ้งคงแผนกไว้'};
 for(const e of events||[]){const div=document.createElement('div');div.className='history-row';div.textContent=new Date(e.created_at).toLocaleString('th-TH',{timeZone:'Asia/Bangkok'})+' · '+(e.department_code||'')+' · '+(['REQUEST_HEADER_UPDATED','REQUEST_FULL_UPDATED'].includes(e.details?.kind)?'แก้ไขข้อมูลใบแจ้ง':e.details?.kind==='ADMIN_RETURN_TO_OWNER'?'System Admin ส่งกลับให้ผู้รับผิดชอบแก้ไข':e.details?.kind==='SELF_RESPONSE'?({REQUESTER_PASS:'บันทึกคำตอบเอง',REQUEST_APPROVAL:'ส่งคำตอบให้หัวหน้าตรวจ',APPROVE:'อนุมัติคำตอบ',RETURN:'ส่งคำตอบกลับแก้ไข'})[e.action]||e.action:names[e.action]||e.action);box.append(div)}
 if(!events?.length)box.textContent='ยังไม่มีประวัติการดำเนินงาน';
 }catch(e){box.textContent='ไม่สามารถโหลดประวัติ: '+e.message}
}
function renderTracker(d){
 const all=d.assignments||[],originView=d.is_requester||QA.profile.role==='system_admin'||String(d.from_department||'').toLowerCase()===String(QA.profile.department||'').toLowerCase(),issueId=originView?null:QAStatus.issueFromHash(location.hash);
 if(originView&&!issuerEntryNormalized){trackerDepartment='';issuerEntryNormalized=true;}
 const requestedDepartment=trackerDepartment;
 const idsParam=new URLSearchParams(location.search).get('assignments');
 const assignmentIds=originView||idsParam===null?null:idsParam.split(',').filter(Boolean);
 const departments=[...new Set(all.map(a=>String(a.department_code)))];
 let selectedDepartment=departments.find(code=>code.toLowerCase()===requestedDepartment.toLowerCase())||'';
 const chips=$('departmentChips');chips.replaceChildren();chips.hidden=departments.length<=1;
 function updateTracker(){
  const assignments=QAStatus.scope(all,{issueId,department:selectedDepartment,assignmentIds});
  const status=QAStatus.aggregate(assignments),current=QAStatus.stage(status),ids=new Set(assignments.map(a=>String(a.assignment_id)));
  $('jobTrackerNumber').textContent=d.car_code||d.job_id;
  $('trackerScope').textContent=selectedDepartment?'สถานะแผนก '+selectedDepartment:issueId?'สถานะปัญหาที่เลือก':'สถานะรวมของใบงาน';
   const returned=status==='IN_PROGRESS'&&assignments.length>0&&assignments.every(a=>a.needs_rework&&!a.approval_requested_at);
  $('jobTracker').setAttribute('aria-label','ข้อมูลใบงาน · '+(returned?'ส่งกลับแก้ไข':status==='WAITING_REVIEW'?'รอฝ่ายผู้แจ้งตรวจรับ':QAStatus.label(status)));
  const origin=d.from_department==='SYSTEM'?'System Admin':d.from_department||'-';
  const self=assignments.some(a=>a.self_response),receivers=[...new Set(assignments.filter(a=>!a.self_response).map(a=>a.department_code))];
  $('recordOrigin').textContent=origin+(self?' · ตอบเอง':'');
  $('recordReceivers').textContent=receivers.join(', ')||'-';
  $('recordReceivers').hidden=self&&!receivers.length;
  $('recordOrigin').closest('.record-route')?.setAttribute('aria-label',self&&!receivers.length?'แผนกผู้แจ้งตอบเอง':'แผนกผู้แจ้งถึงแผนกรับเรื่อง');
  if($('recordRouteArrow'))$('recordRouteArrow').hidden=$('recordReceivers').hidden;
  $('jobTracker').classList.toggle('is-mixed',status==='MIXED');
  document.querySelectorAll('.tracker-stages [data-step]').forEach((el,i)=>{
   el.classList.toggle('done',current>=0&&i<current);el.classList.toggle('current',i===current);
   if(i===current)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');
   el.querySelector('.track-node').textContent=current>=0&&i<current?'✓':String(i+1);
  });
  document.querySelector('.tracker-stages')?.style.setProperty('--track-progress',String(Math.max(0,current)*25)+'%');
  [...chips.children].forEach(b=>{const active=b.dataset.department===selectedDepartment;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});
  // Filter existing nodes instead of rebuilding forms, preserving drafts, upload queues and handlers.
  document.querySelectorAll('.issue-disclosure').forEach(fold=>{
   const related=(fold.dataset.assignmentIds||'').split(',');
   const show=assignments.some(a=>related.includes(String(a.assignment_id))&&(a.issues||[]).some(i=>String(i.issue_id)===fold.dataset.issueId));
   fold.dataset.departmentFiltered=String(!show);
  });
  document.querySelectorAll('.issue-operation-group[data-assignment]').forEach(group=>group.dataset.departmentFiltered=String(!ids.has(group.dataset.assignment)));
  document.querySelectorAll('[data-filter-assignment]').forEach(node=>node.dataset.departmentFiltered=String(!ids.has(node.dataset.filterAssignment)));
  const count=document.querySelector('#allIssues>.section-count');if(count){const issues=new Set(assignments.flatMap(a=>(a.issues||[]).map(i=>String(i.issue_id))));count.textContent=issues.size+' ปัญหา · '+new Set(assignments.map(a=>a.department_code)).size+' แผนก';}
 }
 function choose(code){selectedDepartment=selectedDepartment===code?'':code;trackerDepartment=selectedDepartment;updateTracker();if(selectedDepartment){const a=all.find(a=>a.department_code===selectedDepartment);if(a)guideDetail({assignmentId:a.assignment_id,navigate:true});}}
 if(departments.length>1){
  const any=document.createElement('button');any.type='button';any.dataset.department='';any.textContent='ทั้งหมด';any.onclick=()=>{selectedDepartment='';trackerDepartment='';updateTracker();};chips.append(any);
  departments.forEach(code=>{const b=document.createElement('button');b.type='button';b.dataset.department=code;b.textContent=code+' · '+QAStatus.label(QAStatus.aggregate(all.filter(a=>a.department_code===code)));b.onclick=()=>choose(code);chips.append(b);});
 }
 updateTracker();
}
window.addEventListener('hashchange',()=>{if(detail){renderTracker(detail);guideDetail({issueId:QAStatus.issueFromHash(location.hash),navigate:true});}});

async function resolveUnrelatedReceiver(a,root,button){
 if(!QAWorkflow.permissions(QA.profile,detail,a).canResolveUnrelated){setNote('เฉพาะหัวหน้าฝ่ายผู้แจ้งหรือ System Admin เท่านั้นที่พิจารณาได้',true);return;}
 const issueId=root.querySelector('.unrelated-issue').value,target=root.querySelector('.unrelated-target').value;
 if(!target){setNote('กรุณาเลือกฝ่ายรับเรื่องใหม่',true);return;}
 const issue=a.issues.find(i=>String(i.issue_id)===issueId);if(!issue)return;
 const others=detail.assignments.filter(x=>x.assignment_id!==a.assignment_id&&x.issues.some(i=>String(i.issue_id)===issueId)).map(x=>x.department_code);
 const departments=[...new Set([...others,target])];
 if(!confirm('ย้ายเฉพาะปัญหา '+issue.issue_number+' จาก '+a.department_code+' ไป '+target+'?\nปัญหาข้ออื่นของแผนกนี้และฝ่ายรับเรื่องอื่นยังคงเดิม'))return;
 button.disabled=true;
 try{
  const result=await rpc('qa_v51_resolve_unrelated_change',{p_issue_id:issueId,p_assignment_id:a.assignment_id,p_expected_version:a.version,p_departments:departments});
  await render();
  
  if(result.event_id){const event={event_id:result.event_id,issue_id:issueId,issue_number:issue.issue_number,old_departments:result.old_departments,new_departments:result.new_departments};sessionStorage.setItem('qa-v49-pending-line:'+jobId,JSON.stringify(event));await notifyReceiverChange(event);}
  else setNote('เปลี่ยนฝ่ายรับเรื่องแล้ว');
 }catch(e){setNote('เปลี่ยนฝ่ายรับเรื่องไม่สำเร็จ: '+e.message,true);button.disabled=false;}
}
let returnWarning='';
async function returnHome(action){
 returnWarning='';
 if(!window.QAReturn?.isTerminal(action))return false;
 if(activePickers.some(p=>p.isPreparing())||responseDrafts.size||[...responseQueues.values()].some(queue=>queue.length)){setNote(returnWarning='ทำรายการสำเร็จแล้ว — ยังมีข้อมูลหรือไฟล์ของงานส่วนอื่นที่ยังไม่ได้บันทึก จึงคงหน้านี้ไว้');return false;}
 try{if(JSON.parse(sessionStorage.getItem('qa-full-edit-lines:'+jobId)||'[]').length){setNote(returnWarning='ทำรายการสำเร็จแล้ว แต่ยังมีการแจ้ง LINE ที่ค้าง กรุณากดส่งซ้ำก่อนออกจากหน้านี้',true);return false;}}catch{}
 if(!await QAWork.flushAll()){setNote(returnWarning='ทำรายการสำเร็จแล้ว — ยังมีคอมเมนต์ที่บันทึกไม่สำเร็จ จึงคงหน้านี้ไว้',true);return false;}
 return QAReturn.home(action);
}
const pendingAssignmentActions=new Set();
async function act(a,action,el){
 if(pendingAssignmentActions.has(a.assignment_id))return;
 if(!await QAWork.flushAll()){setNote('ยังมีคอมเมนต์ที่บันทึกไม่สำเร็จ',true);return;}
 if(activePickers.some(p=>p.isPreparing())){setNote(QAMediaPicker.preparingMessage);return;}
 if(!QAWorkflow.allowed(action,QA.profile,detail,a,{legacyLocked:a._legacyLocked===true})){setNote('บัญชีนี้ไม่มีสิทธิ์ทำรายการนี้ในสถานะปัจจุบัน',true);return;}
 let data={};if(['SAVE_DRAFT','REQUEST_APPROVAL','HEAD_SEND'].includes(action)){data={receiver_problem_detail:a.receiver_problem_detail||'',problem_analysis:el.querySelector('.analysis').value,corrective_action:el.querySelector('.fix').value,preventive_action:el.querySelector('.prevent').value};}
 if(action==='UNRELATED_REQUEST'){const reason=prompt('แจ้งไม่เกี่ยวข้องกับแผนก '+a.department_code+' ก่อนรับงาน\nครอบคลุมปัญหา '+a.issues.map(i=>i.issue_number).join(', ')+' ที่แผนกนี้ได้รับ\nระบุเหตุผลเพื่อส่งให้หัวหน้าฝ่ายผู้แจ้งพิจารณา');if(!reason?.trim())return;data={reason:reason.trim()};}
 if(action==='UNRELATED_CONFIRM'&&!confirm('ยืนยันว่าแผนก '+a.department_code+' ไม่เกี่ยวข้องกับปัญหา '+a.issues.map(i=>i.issue_number).join(', ')+' ทั้งหมดที่แผนกนี้ได้รับ?\nจะยกเลิกเฉพาะการมอบหมายให้แผนกนี้ แผนกอื่นคงเดิม'))return;
 if(['REQUESTER_PASS','REQUESTER_FAIL'].includes(action)){const note=el.querySelector('.live-final-review-comment')?.value.trim()||'';if(action==='REQUESTER_FAIL'&&!note){setNote('กรุณาระบุความคิดเห็นก่อนตรวจรับไม่ผ่าน',true);return;}data={reason:note};}
 if(action==='RETURN'){const reason=prompt(action==='RETURN'?'ระบุเหตุผลที่ไม่อนุมัติ':'ระบุเหตุผลที่ไม่ผ่าน');if(!reason?.trim())return;data={reason:reason.trim()};}

 if(['APPROVE','REQUESTER_PASS','UNRELATED_REJECT'].includes(action)&&!confirm('ยืนยันการดำเนินการ?'))return;
 const actionBar=document.querySelector('.department-action-bar[data-assignment="'+CSS.escape(String(a.assignment_id))+'"]');
 const buttons=[...(actionBar?.querySelectorAll('button')||[])];
 pendingAssignmentActions.add(a.assignment_id);el.inert=true;
 buttons.forEach(b=>{b.disabled=true;b.setAttribute('aria-busy','true');b.dataset.originalText=b.textContent;});
 const pressed=buttons.find(b=>b.dataset.originalText===({HEAD_SEND:'ส่งงาน',REQUEST_APPROVAL:'ส่งให้หัวหน้าตรวจสอบ',APPROVE:'อนุมัติและส่งงาน'}[action]||''));
 if(pressed)pressed.textContent='กำลังบันทึก...';
 try{setNote('กำลังบันทึก...');let expected=a.version;let result;
 if(['SAVE_DRAFT','REQUEST_APPROVAL','HEAD_SEND'].includes(action)){
   if(!Object.prototype.hasOwnProperty.call(a,'preventive_action'))throw new Error('ยังไม่ได้อัปเดตส่วนบันทึกการป้องกัน กรุณารัน SQL ในชุดอัปเดตนี้ก่อน ข้อความที่กรอกยังคงอยู่');
   const saved=await rpc('qa_vnext_assignment_action',{p_assignment_id:a.assignment_id,p_action:'SAVE_DRAFT',p_expected_version:expected,p_data:data});
   expected=Number(saved.version);if(!Number.isInteger(expected)||expected<1)throw new Error('INVALID_SAVED_VERSION');a.version=expected;
   const draft=responseDrafts.get(el.dataset.queueKey);if(draft)draft.version=expected;
   const state=el.querySelector('.response-draft-state');if(state){state.textContent='บันทึกข้อความแบบร่างแล้ว กำลังตรวจไฟล์แนบ — ยังไม่ได้ส่ง';state.dataset.state='draft';}
   const check=await rpc('qa_vnext_job_detail',{p_job_id:jobId});
   const stored=(check.assignments||[]).find(row=>String(row.assignment_id)===String(a.assignment_id));
   if(!stored||!Object.prototype.hasOwnProperty.call(stored,'preventive_action')||String(stored.preventive_action??'')!==String(data.preventive_action??'').replace(/^ +| +(?![\s\S])/g,''))throw new Error('ตรวจสอบการบันทึกการป้องกันไม่สำเร็จ ยังไม่ได้ส่งงาน ข้อความที่กรอกยังคงอยู่ กรุณาตรวจ SQL แล้วกดบันทึกอีกครั้ง');
   await uploadResponse(a.assignment_id,responseQueues.get(el.dataset.queueKey)||[]);
   if(action==='SAVE_DRAFT')result=saved;
 }
 if(['REQUESTER_PASS','REQUESTER_FAIL'].includes(action))result=await rpc('qa_workflow_review_v1',{p_assignment_id:a.assignment_id,p_action:action,p_expected_version:expected,p_comment:data.reason||''});
 else if(action!=='SAVE_DRAFT')result=await rpc('qa_vnext_assignment_action',{p_assignment_id:a.assignment_id,p_action:action,p_expected_version:expected,p_data:['REQUEST_APPROVAL','HEAD_SEND'].includes(action)?{}:data});
 if(el.dataset.queueKey){responseDrafts.delete(el.dataset.queueKey);responseQueues.delete(el.dataset.queueKey);}
 if(await returnHome(action))return;
 if(!returnWarning)setNote(action==='REOPEN_RESPONSE'?'เปิดแก้ไขแล้ว — แก้ข้อมูลและส่งตรวจใหม่':action==='SAVE_DRAFT'?(QAWorkflow.permissions(QA.profile,detail,a).canHeadSend?'บันทึกแบบร่างแล้ว — ยังไม่ได้ส่งงาน':'บันทึกแบบร่างแล้ว — ยังไม่ได้ส่งหัวหน้าตรวจสอบ'):['REQUEST_APPROVAL','HEAD_SEND'].includes(action)?'ส่งงานสำเร็จ':'บันทึกสำเร็จ');await render({assignmentId:a.assignment_id,action});
 }catch(e){
  if(String(e.message||e).includes('VERSION_CONFLICT')){setNote('ข้อมูลใบงานถูกอัปเดตระหว่างเปิดหน้านี้ ยังไม่ได้ส่งงาน ข้อความที่กรอกยังอยู่ กรุณาคัดลอกไว้ก่อนเปิดข้อมูลล่าสุดแล้วส่งใหม่',true);}
  else{const state=el.querySelector('.response-draft-state');if(state&&['SAVE_DRAFT','REQUEST_APPROVAL','HEAD_SEND'].includes(action)){state.textContent='บันทึก/ส่งงานยังไม่ครบ — ตรวจข้อความแจ้งข้อผิดพลาดแล้วกดอีกครั้ง ยังไม่ได้ส่ง';state.dataset.state='unsaved';}setNote('ไม่สามารถบันทึกได้: '+e.message,true);}
 }finally{el.inert=false;pendingAssignmentActions.delete(a.assignment_id);buttons.forEach(b=>{b.disabled=false;b.removeAttribute('aria-busy');if(b.dataset.originalText)b.textContent=b.dataset.originalText;});}
}
async function adminReturnToOwner(assignment,button){
 if(button.disabled)return;
 if(activePickers.some(p=>p.isPreparing())){setNote(QAMediaPicker.preparingMessage,true);return;}
 const recipient=assignment.responsible_name||'ผู้รับผิดชอบคนเดิม';
 const reason=prompt('ระบุเหตุผลที่ส่งกลับให้ '+recipient+' แก้ไข');
 if(reason===null)return;
 if(!reason.trim()){setNote('กรุณาระบุเหตุผลที่ส่งกลับแก้ไข',true);return;}
 if(reason.trim().length>2000){setNote('เหตุผลต้องไม่เกิน 2,000 ตัวอักษร',true);return;}
 button.disabled=true;
 try{
  if(window.QAWork&&!await QAWork.flushAll()){setNote('ยังมีคอมเมนต์ที่บันทึกไม่สำเร็จ',true);return;}
  await rpc('qa_admin_return_to_owner_v1',{
   p_assignment_id:assignment.assignment_id,p_expected_version:assignment.version,p_reason:reason.trim()
  });
  if(await render({assignmentId:assignment.assignment_id,rollbackReason:true})){
   setNote('ส่งกลับให้ '+recipient+' แก้ไขแล้ว');
  }
 }catch(error){
  const code=String(error.message||error);
  const message=code.includes('RETURN_OWNER_NOT_ACTIVE')?'ผู้รับผิดชอบเดิมไม่สามารถรับงานในแผนกนี้ได้':
   code.includes('ALREADY_RETURNED_TO_OWNER')?'ใบงานนี้ส่งกลับให้ผู้รับผิดชอบแก้ไขแล้ว':requestEditError(error);
  setNote('ส่งกลับแก้ไขไม่สำเร็จ: '+message,true);
 }finally{button.disabled=false;}
}
async function uploadResponse(assignmentId,entries){
 for(const entry of entries){const file=entry.file;QAMediaPicker.validate([file]);
  if(!entry.attachmentId){const ext=file.name.split('.').pop().toLowerCase().replace(/[^a-z0-9]/g,'').slice(0,8)||'bin',path=`${QA.profile.user_id}/${crypto.randomUUID()}.${ext}`;
   const {error}=await QA.client.storage.from('qa-vnext-media').upload(path,file,{contentType:file.type,upsert:false});if(error)throw error;
   try{const registered=await rpc('qa_vnext_register_attachment',{p_job_id:jobId,p_scope:'ASSIGNMENT',p_issue_number:null,p_assignment_id:assignmentId,p_kind:file.type.startsWith('image/')?'IMAGE':'VIDEO',p_path:path,p_mime_type:file.type,p_size_bytes:file.size});if(!registered?.attachment_id)throw Error('ลงทะเบียนไฟล์แนบไม่สำเร็จ');entry.attachmentId=registered.attachment_id;}
   catch(e){try{await QA.client.storage.from('qa-vnext-media').remove([path]);}catch{}throw e;}
  }
  const note=entry.note||'';if(entry.savedNote!==note){if(note||entry.savedNote!==undefined)await rpc('qa_v38_media_set_note',{p_attachment_id:entry.attachmentId,p_note:note});entry.savedNote=note;}
 }
}
// Structured A4 document: text stays selectable and sections may flow across pages.
// Detail and attachment data are already scoped by the server-side V38 RPCs.
async function exportStructuredPdf(preview){return QALiveReport.open(preview,{detail:{...detail,assignments:detail.assignments.filter(a=>!a._catalogRead)},media,jobId,rpc,getUrl,rounds:completedRounds,history:detail._workflow_history||[]});}
$('pdfButton').onclick=async()=>{
 const preview=window.open('','_blank');
 if(!preview){setNote('กรุณาอนุญาต Pop-up สำหรับ PDF',true);return;}
 try{
  preview.document.title='กำลังเตรียมรายงาน';
  if(preview.document.body)preview.document.body.textContent='กำลังเตรียมรายงาน...';
  if(!window.QALiveReport?.open)await QAFeatureScript.load('workflow-report.js?v=r16');
  if(!preview.closed)await exportStructuredPdf(preview);
 }catch(e){try{preview.close()}catch{}setNote('Export PDF ไม่สำเร็จ: '+e.message,true);}
};

async function boot(){for(let i=0;i<160&&!QA.profile;i++)await new Promise(r=>setTimeout(r,100));if(!QA.profile){setNote('Login ไม่พร้อม',true);detailState('error');return;}const params=new URLSearchParams(location.search);
 if(params.get('notification')==='1'&&/^[a-f\d-]{36}$/i.test(params.get('assignment')||'')){
  if(!await render({assignmentId:params.get('assignment'),rollbackReason:params.get('rollback-reason')==='1'}))return;
 }else if(!await render())return;
 if(!detail._catalogOnly)await window.QAReadState?.markOpened({...detail,assignments:detail.assignments.filter(a=>!a._catalogRead)});}
boot();
})();
