(()=>{'use strict';
const $=id=>document.getElementById(id);
const dashboardQuery=new URLSearchParams(location.search);
const allJobsMode=dashboardQuery.get('view')==='all';
const catalogScopes={all:'ทุกแผนก',department:'แผนกของฉัน',mine:'งานของฉัน',received:'งานเข้าแผนก',department_sent:'งานที่แผนกแจ้ง',reported:'งานที่ฉันแจ้ง'};
const catalogDate=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'});
if(allJobsMode)document.documentElement.dataset.dashboardView='all';
const classification=window.QAIssueClassification;
let selectedCategory='';
const statuses=[['IN_PROGRESS','กำลังดำเนินงาน','#f4ae3c'],['WAITING_REVIEW','รอตรวจสอบ','#268ae5'],['CLOSED','สำเร็จ','#2cbd7b']];
const safe=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const norm=v=>String(v??'').trim().toLowerCase();
const dt=j=>{const s=String(j.createdDateTime||'');const d=new Date(s.replace(' ','T'));return Number.isNaN(+d)?0:+d};
const timeText=j=>{
 const raw=String(j.createdDateTime||'').trim();
 if(!raw)return '—';
 const date=new Date(raw.includes('T')?raw:raw.replace(' ','T'));
 if(Number.isNaN(date.getTime()))return '—';
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Bangkok',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 const get=k=>parts.find(x=>x.type===k)?.value||'';
 return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
};
function issueTimestamp(entry){return Date.parse(entry.issue.reported_at||'')||dt(entry.job);}
function compareLatestIssueRows(a,b){
 return issueTimestamp(b)-issueTimestamp(a)||String(b.job.jobId).localeCompare(String(a.job.jobId))
  ||Number(b.issue.issue_number||0)-Number(a.issue.issue_number||0)
  ||String(b.issue.issue_id||'').localeCompare(String(a.issue.issue_id||''));
}

let all=[],base=[],selected='all',selectedDept='',page=0,receiverCodes=null,receiverError='',globalAggregate=null,summaryRequest=0,loadRequest=0;const pageSize=20;
const compactLatest=window.matchMedia?.('(max-width:767px), (max-height:799px)');
function viewFilteredJobs(filters={}){
 const params=new URLSearchParams({view:'all'});
 for(const [key,value] of Object.entries(filters)){
  if(value&&value!=='all')params.set(key,value);
 }
 location.assign('dashboard.html?'+params);
}
function bangkokKey(j){if(dt(j))return catalogDate.format(new Date(dt(j)));const s=String(j.createdDateTime||'');let m=s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);if(m)return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;m=s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:''}
function weekKey(v){const d=new Date(v+'T12:00:00+07:00');if(isNaN(+d))return '';const day=(d.getUTCDay()+6)%7;d.setUTCDate(d.getUTCDate()-day+3);const first=new Date(Date.UTC(d.getUTCFullYear(),0,4));const n=1+Math.round(((d-first)/86400000-3+(first.getUTCDay()+6)%7)/7);return `${d.getUTCFullYear()}-W${String(n).padStart(2,'0')}`}
function periodMatch(j){const type=$('filter').value;if(!allJobsMode||type==='all')return true;const key=j.issueReportedAt?catalogDate.format(new Date(j.issueReportedAt)):bangkokKey(j);if(!key)return false;if(type==='day')return key===$('day').value;if(type==='week')return weekKey(key)===$('week').value;if(type==='month')return key.slice(0,7)===$('month').value;return key.slice(0,4)===$('year').value}
// Work status is held by the receiving department, not qa_jobs.status.
// OPEN (not yet accepted), IN_PROGRESS, REWORK -> yellow. Only explicit
// requester acceptance (CLOSED) turns the department green.
function groupStatus(v){const s=String(v||'').toUpperCase();if(s==='WAITING_REVIEW')return 'WAITING_REVIEW';if(s==='CLOSED')return 'CLOSED';if(['OPEN','IN_PROGRESS','REWORK','ASSIGNED','PENDING'].includes(s))return 'IN_PROGRESS';return null;}
function enabledAssignments(j){return j.departmentAssignments||[];} // Include historical assignments even if receiver setting was disabled later.
// A countable work item is a unique issue in one department assignment.
// The same issue assigned to two departments represents two separately tracked actions.
function assignmentIssues(a){const found=new Set();return (a.issues||[]).filter(i=>{const key=String(i.issue_id??i.issue_number??'');if(!key||found.has(key))return false;found.add(key);return true;});}
// One issue gets one suffix across every receiving department. The suffix is the
// persisted issue_number, NOT an assignment's position in a viewer-specific list.
function displayIssueCode(j,issue){
 return String(j.carCode||j.jobId||'—')+'-'+String(issue.issue_number||1).padStart(2,'0');
}
// Dashboard list: ONE issue_id per row, irrespective of how many departments receive it.
// Chart statistics intentionally continue counting issue x receiving department.
function issueRowsFor(j){
 const byIssue=new Map();
 for(const a of deptAssignments(j))for(const issue of assignmentIssues(a)){
  const key=String(issue.issue_id||issue.issue_number);
  let e=byIssue.get(key);
  if(!e){e={job:j,issue,assignments:[],departments:[],statuses:new Set()};byIssue.set(key,e);}
  e.assignments.push(a);if(a.department&&!e.departments.includes(a.department))e.departments.push(a.department);
  if(a.chartStatus)e.statuses.add(a.chartStatus);
 }
 return [...byIssue.values()];
}
function issueRowStatus(e){
 const scoped=QAStatus.scope(e.assignments,{department:selectedDept});
 return QAStatus.aggregate(scoped.map(a=>a.selfReview?{rawStatus:'WAITING_REVIEW'}:a));
}
function issueStatusLabel(e,status){
 const scoped=QAStatus.scope(e.assignments,{department:selectedDept});
 if(status==='IN_PROGRESS'&&scoped.length&&scoped.every(a=>a.needsRework&&!a.approvalRequestedAt))return 'ส่งกลับแก้ไข';
 if(scoped.length===1&&scoped[0].selfResponse){
  const a=scoped[0];
  if(a.selfReview)return 'รอหัวหน้าตรวจ';
  if(a.selfReturned)return 'ส่งกลับแก้ไข';
  if(status==='IN_PROGRESS')return 'รอบันทึกคำตอบ';
 }
 return QAStatus.label(status);
}
// Match department and status on the SAME visible assignment. A shared issue's
// status in another department must not satisfy the selected bar segment.
function rowMatchesChart(e){return e.assignments.some(a=>(!selectedDept||norm(a.department)===norm(selectedDept))&&(selected==='all'||(selected==='CANCELLED'?a.rawStatus===selected:a.chartStatus===selected)));}

function deptAssignments(j){const p=window.QA?.profile||{}, dept=norm(p.department);const role=String(p.role||'').toLowerCase();
 if(allJobsMode){
  const scope=$('dashScope').value,assignments=enabledAssignments(j);
  if(scope==='department')return norm(j.fromDepartment)===dept&&dept
    ? assignments : assignments.filter(a=>dept&&norm(a.department)===dept);
  if(scope==='mine'&&!j.isRequester)return assignments.filter(a=>a.isMyWork);
  if(scope==='received')return assignments.filter(a=>dept&&norm(a.department)===dept);
  if(scope==='department_sent')return dept&&norm(j.fromDepartment)===dept?assignments:[];
  if(scope==='reported')return j.isRequester?assignments:[];
  return assignments;
 }
 let rows=QAWorkflow.visibleAssignments(p,j,enabledAssignments(j));
 // Origin department may track every receiver on its outgoing job.
 // Receiving departments see only their assignments unless also origin.
 if(role==='user'||role==='department_admin')rows=rows.filter(a=>norm(j.fromDepartment)===dept||norm(a.department)===dept);
 return rows;
}
function searchMatch(j){if(!allJobsMode)return true;const q=norm($('dashSearch').value);return !q||[j.carCode,j.jobId,j.customerName,j.country,j.serialNo,j.fromDepartment,j.toDepartment,j.problemDetail,j.status,j.location,j.category,...enabledAssignments(j).flatMap(a=>[a.department,...a.issues.map(i=>i.description)])].some(v=>norm(v).includes(q));}
function selectedGlobalCounts(){const c={IN_PROGRESS:0,WAITING_REVIEW:0,CLOSED:0};
 for(const row of globalAggregate?.departments||[]){if(c[row.status]!==undefined)c[row.status]+=Number(row.count)||0;}return c;}
function render(){base=all.filter(j=>searchMatch(j)&&deptAssignments(j).length>0);
 if(allJobsMode){renderRows();return;}
 const counts=selectedGlobalCounts();
 $('nTotal').textContent=globalAggregate?Object.values(counts).reduce((a,b)=>a+b,0).toLocaleString('th-TH'):'—';
 $('nProgress').textContent=globalAggregate?counts.IN_PROGRESS.toLocaleString('th-TH'):'—';
 $('nReview').textContent=globalAggregate?counts.WAITING_REVIEW.toLocaleString('th-TH'):'—';
 $('nDone').textContent=globalAggregate?counts.CLOSED.toLocaleString('th-TH'):'—';
 renderCharts(counts);renderRows();}

function renderCharts(counts){
 const depts=receiverCodes?[...new Set([...receiverCodes,...(globalAggregate?.departments||[]).map(a=>a.department)])]:[];
 const byDept=new Map(depts.map(d=>[d,{IN_PROGRESS:0,WAITING_REVIEW:0,CLOSED:0}]));
 for(const e of globalAggregate?.departments||[]){const x=byDept.get(e.department);if(x&&x[e.status]!==undefined)x[e.status]+=Number(e.count)||0;}
 const max=Math.max(1,...depts.map(d=>Object.values(byDept.get(d)).reduce((x,y)=>x+y,0)));
 const ticks=Math.min(4,max);
 $('axis').innerHTML=Array.from({length:ticks+1},(_,i)=>`<span>${Math.round(max*(ticks-i)/ticks)}</span>`).join('');
 $('barLegend').innerHTML=statuses.map(([s,label,color])=>`<button type="button" class="legend-action" data-chart-status="${s}" title="กรอง ${safe(label)}"><i style="background:${color}"></i>${label}</button>`).join('');
 $('plot').innerHTML=depts.length?depts.map(department=>{
  const counts=byDept.get(department);
  const total=Object.values(counts).reduce((sum,count)=>sum+count,0);
  const dept=safe(department);
  const segments=statuses.map(([status,label,color])=>{
   const count=counts[status]||0;
   if(!count)return '';
   return `<button type="button" class="bar-segment" data-chart-status="${status}" data-chart-dept="${dept}"
    title="${dept} / ${safe(label)}: ${count} ปัญหา" aria-label="กรอง ${dept} สถานะ ${safe(label)} ${count} ปัญหา"
    style="background:${color};height:${count/total*100}%"></button>`;
  }).join('');
  return `<div class="bar-item">
   <div class="bar-rail"><div class="bar-fill" style="height:${total/max*100}%">
    <button type="button" class="bar-total chart-dept" data-chart-dept="${dept}" title="กรองแผนก ${dept}">${total}</button>
    <div class="bar-stack">${segments}</div>
   </div></div>
   <button type="button" class="bar-label chart-dept" data-chart-dept="${dept}" title="กรองแผนก ${dept}">${dept}</button>
  </div>`;
 }).join(''):`<div class="empty">${safe(receiverError||'ยังไม่ได้เปิดฝ่ายรับเรื่องใน Settings')}</div>`;
 const countTotal=statuses.reduce((sum,[s])=>sum+(counts[s]||0),0);
 let pos=0;const parts=statuses.map(([s,label,color])=>{const n=counts[s]||0,from=pos;pos+=countTotal?n/countTotal*100:0;return {s,label,color,n,from,to:pos}});
 $('donut').style.background=countTotal?`conic-gradient(${parts.filter(p=>p.n).map(p=>`${p.color} ${p.from}% ${p.to}%`).join(',')})`:'#e4e8ef';
 $('donutTotal').textContent=countTotal.toLocaleString('th-TH');
 $('donutLegend').innerHTML=parts.map(p=>`<button type="button" class="legend-row legend-action" data-chart-status="${p.s}" title="กรอง ${safe(p.label)}"><span><i class="dot" style="background:${p.color}"></i>${p.label}</span><b class="legend-values"><span class="legend-count">${p.n}</span><span class="legend-percent">(${countTotal?(p.n/countTotal*100).toFixed(1):'0.0'}%)</span></b></button>`).join('');
 $('donut').dataset.parts=JSON.stringify(parts.filter(p=>p.n).map(({s,from,to})=>({s,from,to})));
 syncHomeChartSelection();
}

let issueReadStates=new Map();
function readMarker(job,issue){
 const item=issueReadStates.get(window.QAReadState?.key(job.jobId,issue.issue_id));
 if(!item||typeof item.is_unread!=='boolean')return '<span class="read-state unknown" role="img" aria-label="ยังโหลดสถานะการอ่านไม่ได้" title="ยังโหลดสถานะการอ่านไม่ได้">—</span>';
 const unread=item.is_unread;
 const label=unread?'ยังไม่ได้เปิดดู':'เปิดดูแล้ว';
 const path=unread?'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>':'<path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V10Z"/><path d="m3 10 9 6 9-6M3 20l6-6m6 0 6 6"/>';
 return '<span class="read-state '+(unread?'unread':'read')+'" role="img" aria-label="'+label+'" title="'+label+'"><svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+path+'</svg></span>';
}
async function refreshReadStates(){
 const jobs=all;
 const result=await window.QAReadState.load(jobs.filter(j=>!allJobsMode||j.workflowVisible).map(j=>j.jobId));
 if(all===jobs)issueReadStates=result.states;
}
window.addEventListener('pageshow',e=>{if(e.persisted&&all.length)refreshReadStates().then(renderRows);});

const chartCategoryNames=new Map();
const departmentPalette=['#466c9f','#27847f','#8363a7','#ad7048','#5e747c','#8d6f9c','#b96063'];
function issueFieldsMatch(entry){
 const severity=$('severityFilter')?.value,occurrence=$('occurrenceFilter')?.value;
 return (!severity||severity===entry.issue.severity_code)
  &&(!occurrence||occurrence===entry.issue.occurrence_type)
  &&(!selectedCategory||selectedCategory===entry.issue.category_code);
}
function issueChartButton(text,filters){
 const button=document.createElement('button');
 button.type='button';button.textContent=text;button.onclick=()=>viewFilteredJobs(filters);
 return button;
}
function drawIssueCategories(entries){
 const host=$('issueCategoryChart'),key=$('issueCategoryKey');
 const counts=new Map(),departments=new Map();
 for(const entry of entries){
  const category=entry.issue.category_code;
  if(!category)continue;
  const scoped=entry.assignments.filter(a=>a.department);
  if(!scoped.length)continue;
  const byDept=counts.get(category)||new Map();
  counts.set(category,byDept);
  for(const dept of new Set(scoped.map(a=>a.department))){
   byDept.set(dept,(byDept.get(dept)||0)+1);
   if(!departments.has(dept))departments.set(dept,departmentPalette[departments.size%departmentPalette.length]);
  }
 }
 const sorted=[...counts].map(([category,byDept])=>({category,byDept,total:[...byDept.values()].reduce((a,b)=>a+b,0)}))
  .sort((a,b)=>b.total-a.total||a.category.localeCompare(b.category,'th'));
 host.replaceChildren();key.replaceChildren();
 if(!sorted.length){host.textContent='ไม่พบข้อมูล';return;}
 for(const {category,byDept,total} of sorted){
  const row=document.createElement('div');row.className='qa-category-row';
  const name=chartCategoryNames.get(category)||category;
  const label=issueChartButton(name,{category});
  const bar=document.createElement('div');bar.className='qa-category-bar';bar.style.width=(total/sorted[0].total*100)+'%';
  for(const [department,count] of byDept){
   const bit=issueChartButton('',{category,department});
   bit.title=name+' · '+department+' · '+count+' ปัญหา';bit.setAttribute('aria-label',bit.title);
   bit.style.flexGrow=count;bit.style.setProperty('--issue-color',departments.get(department));bar.append(bit);
  }
  const sum=document.createElement('b');sum.textContent=total;
  row.append(label,bar,sum);host.append(row);
 }
 for(const [label,color] of departments){
  const item=document.createElement('span'),dot=document.createElement('i');
  dot.className='qa-issue-dot';dot.style.setProperty('--issue-color',color);
  item.append(dot,label);key.append(item);
 }
}
function drawIssueRing(entries,field,property,options,ringKey){
 const ring=$('issue'+ringKey+'Ring'),key=$('issue'+ringKey+'Key');
 const counts=Object.entries(options).map(([id,meta])=>({id,...meta,count:entries.filter(e=>e.issue[property]===id).length}));
 const total=counts.reduce((sum,x)=>sum+x.count,0),parts=[];
 let end=0;
 key.replaceChildren();
 function choose(id){viewFilteredJobs({[field]:id});}
 for(const {id,name,color,count} of counts){
  if(count){
   const start=end;end+=count/total*100;
   parts.push({id,start,end,color});
  }
  const label=field==='severity'?id+' '+name:name;
  const button=issueChartButton('',{[field]:id});
  const title=document.createElement('span'),dot=document.createElement('i'),value=document.createElement('b');
  dot.className='qa-issue-dot';dot.style.setProperty('--issue-color',color);title.append(dot,label);
  value.textContent=count;button.append(title,value);key.append(button);
 }
 const sum=document.createElement('strong');sum.textContent=total;
 ring.replaceChildren(sum);ring.setAttribute('aria-label',total+' ปัญหา');
 if(parts.length)ring.style.setProperty('--issue-ring','conic-gradient('+parts.map(p=>p.color+' '+p.start+'% '+p.end+'%').join(',')+')');
 else ring.style.removeProperty('--issue-ring');
 ring.onclick=event=>{
  const box=ring.getBoundingClientRect(),radius=box.width/2;
  const x=event.clientX-box.left-radius,y=event.clientY-box.top-box.height/2,dist=Math.hypot(x,y);
  if(dist<radius*.68||dist>radius)return;
  const angle=((Math.atan2(x,-y)*180/Math.PI+360)%360)/3.6;
  const part=parts.find(p=>angle>=p.start&&angle<p.end);
  if(part)choose(part.id);
 };
}
function renderIssueCharts(entries){
 if(!classification)return;
 drawIssueCategories(entries);
 drawIssueRing(entries,'severity','severity_code',classification.levels,'Severity');
 drawIssueRing(entries,'occurrence','occurrence_type',classification.occurrences,'Occurrence');
}
async function loadCategoryNames(){
 if(!window.QA?.api?.getSettings)return;
 const settings=await QA.api.getSettings();
 for(const category of settings.categories||[])chartCategoryNames.set(category.code,category.name);
}
function initIssueSummary(){
 if(!classification)return;
 let requested=false;
 $('issueSummary').addEventListener('toggle',async()=>{
  if(!$('issueSummary').open)return;
  renderRows();
  if(requested)return;
  requested=true;
  try{
   await loadCategoryNames();
   if($('issueSummary').open)renderRows();
  }catch{requested=false;}
 });
}

function renderRows(){
 const entries=base.flatMap(issueRowsFor);
 const filtered=entries.filter(entry=>rowMatchesChart(entry)&&(!allJobsMode||
  periodMatch({...entry.job,issueReportedAt:entry.issue.reported_at})&&issueFieldsMatch(entry))).sort(compareLatestIssueRows);
 if(allJobsMode)renderActiveCatalogFilters();
 else{
  const status=statuses.find(([code])=>code===selected)?.[1];
  $('listTitle').textContent=[selectedDept,status].filter(Boolean).join(' · ')||'ปัญหาแจ้งล่าสุด';
 }
 if(!allJobsMode&&$('issueSummary').open)renderIssueCharts(entries);
 const latestCount=compactLatest?.matches?5:6;
 const count=allJobsMode?pageSize:latestCount;
 const pageCount=Math.max(1,Math.ceil(filtered.length/count));page=Math.max(0,Math.min(page,pageCount-1));
 const show=filtered.slice(page*count,(page+1)*count);
 $('jobRows').innerHTML=show.length?show.map(e=>{
  const j=e.job,i=e.issue,st=issueRowStatus(e),status=issueStatusLabel(e,st);
  const baseUrl='vnext-job.html?id='+encodeURIComponent(j.jobId)+'&assignments='+encodeURIComponent(e.assignments.map(a=>a.assignmentId).join(','))+(selectedDept?'&department='+encodeURIComponent(selectedDept):'');
  const issuer=j.isRequester||norm(j.fromDepartment)===norm(QA.profile?.department)||QA.profile?.role==='system_admin';
  const catalogLink='vnext-job.html?id='+encodeURIComponent(j.jobId)+'&from=all-jobs&scope='+encodeURIComponent($('dashScope').value);
  const url=(allJobsMode?catalogLink:issuer?'vnext-job.html?id='+encodeURIComponent(j.jobId):baseUrl.split('#')[0])+'#issue-'+encodeURIComponent(String(i.issue_id));
  const origin=j.fromDepartment==='SYSTEM'?'System Admin':j.fromDepartment||'—';
  const self=e.assignments.some(a=>a.selfResponse);
  const recipients=[...new Set(e.assignments.filter(a=>!a.selfResponse).map(a=>a.department).filter(Boolean))];
  const route=origin+(self?' · ตอบเอง':'')+((!self||recipients.length)?' → '+(recipients.join(', ')||'—'):'');
  const time=timeText({createdDateTime:i.reported_at||j.createdDateTime});
  const problem=i.description||j.problemDetail||'—';
  const issueCode=displayIssueCode(j,i);
  const profile=window.QA?.profile||{};
  const noticePaths={accept:'<path d="M4 4h16v16H4zM8 8h8M8 12h5"/>',head:'<path d="m5 12 4 4L19 6"/>',review:'<circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/>',work:'<path d="m5 19 3-7L18 2l4 4-10 10-7 3Z"/>',rework:'<path d="M8 5 3 10l5 5M3 10h11a6 6 0 0 1 0 12"/>',unrelated:'<circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 4h.01"/>'};
  const workflowAssignments=allJobsMode?e.assignments.filter(a=>a.workflowVisible):e.assignments;
  const notices=QAWorkflow.notices(profile,j,workflowAssignments).map(n=>{
   const type=n.code.startsWith('unrelated')?'unrelated':n.code.startsWith('rework')?'rework':n.code.startsWith('head')?'head':n.code;
   return '<span class="workflow-notice '+(n.action?'action-required':'informative')+'" data-notice="'+safe(n.code)+'"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(noticePaths[type]||noticePaths.work)+'</svg>'+safe(n.text)+'</span>';
  }).join('');
  return `<a class="job-row" href="${safe(url)}" title="เปิดปัญหา ${safe(issueCode)}"><span class="read-column">${allJobsMode&&!workflowAssignments.length?'—':readMarker(j,i)}</span><span title="${safe(issueCode)}"><b>${safe(issueCode)}</b></span><span title="${safe(j.customerName)}">${safe(j.customerName||'ไม่ระบุ')}</span><span title="${safe(j.serialNo)}">${safe(j.serialNo||'—')}</span><span class="route" title="${safe(route)}">${safe(route)}</span><span class="qa-problem-list-text" title="${safe(problem)}"><span>${safe(problem)}</span>${classification?.badge(i.severity_code,true)||''}</span><span><i class="pill ${safe(st)}">${safe(status)}</i>${notices}</span><span title="${safe(time)}">${safe(time)}</span></a>`;
 }).join(''):'<div class="empty">ไม่พบรายการปัญหา</div>';
 $('pagination').hidden=!allJobsMode||filtered.length<=pageSize;$('prevPage').disabled=page===0;$('nextPage').disabled=page>=pageCount-1;$('pageInfo').textContent=`หน้า ${page+1} / ${pageCount}`;
 if(allJobsMode)queueCatalogMetadata(show);
}

let returningView=null;
function rememberDashboard(){
 if(!allJobsMode)window.QAReturn?.saveDashboard({selected,selectedDept,scrollY:Math.max(0,window.scrollY||0)});
}
const periodKinds=['day','week','month','year'];
function showCatalogTopic(){
 const topic=$('filterTopic').value;
 for(const label of $('allJobFilters').querySelectorAll('[data-filter-field]')){
  label.hidden=label.dataset.filterField!==topic;
 }
 for(const kind of periodKinds)$(kind).hidden=topic!=='period'||$('filter').value!==kind;
 $('showSeverityGuide').hidden=topic!=='severity';
 renderActiveCatalogFilters();
}
function updatePeriod(){showCatalogTopic();page=0;renderRows();}
function renderActiveCatalogFilters(){
 const host=$('activeJobFilters'),topic=$('filterTopic');
 host.replaceChildren();
 let active=0;
 for(const option of topic.options){
  const key=option.value;
  const control=$('allJobFilters').querySelector('[data-filter-field="'+key+'"] :is(input,select)');
  const initial=['scope','status','period'].includes(key)?'all':'';
  const value=control.value.trim();
  if(!value||value===initial)continue;
  active++;
  if(key===topic.value)continue;
  const period=key==='period'&&periodKinds.includes(value)?' '+$(value).value:'';
  const label=option.textContent+' · '+(control.selectedOptions?.[0]?.textContent||value)+period;
  const chip=document.createElement('button');
  chip.type='button';chip.className='secondary';chip.textContent=label+' ×';
  chip.setAttribute('aria-label','ล้างตัวกรอง '+label);
  chip.onclick=()=>{
   control.value=initial;
   control.dispatchEvent(new Event(key==='search'?'input':'change'));
   (host.querySelector('button')||topic).focus();
  };
  host.append(chip);
 }
 host.hidden=!host.childElementCount;
 $('clearAllJobFilters').hidden=!active;
}
function initExcel(){
 const profile=QA.profile||{},role=String(profile.role||'').toLowerCase(),button=$('exportExcel');
 if(!button||profile.active===false||profile.approval_status&&profile.approval_status!=='APPROVED'||
    !['system_admin','department_admin','user','viewer'].includes(role)||role!=='system_admin'&&!String(profile.department||'').trim())return;
 button.hidden=false;button.disabled=false;
 button.addEventListener('click',async()=>{
  const note=$('excelExportStatus');
  if(!window.QAExcelExport?.download){
   button.disabled=true;
   button.setAttribute('aria-busy','true');
   note.textContent='กำลังโหลดเครื่องมือ Excel...';
   try{
    await QAFeatureScript.load('dashboard-excel.js?v=performance-20261125-r15');
    if(!window.QAExcelExport?.download)throw Error('เครื่องมือ Excel ไม่พร้อม');
   }
   catch(e){note.textContent='ดาวน์โหลด Excel ไม่สำเร็จ: '+e.message;return;}
   finally{button.disabled=false;button.removeAttribute('aria-busy');}
  }
  await QAExcelExport.download();
 });
}
function initCatalogFilters(){
 const scopes=$('dashScope'),status=$('allJobsStatus');
 scopes.replaceChildren(...Object.entries(catalogScopes).map(([key,label])=>new Option(label,key)));
 const savedScope=dashboardQuery.get('scope');
 scopes.value=Object.hasOwn(catalogScopes,savedScope)?savedScope:'all';
 selected=status.value=[...status.options].some(option=>option.value===dashboardQuery.get('status'))?dashboardQuery.get('status'):'all';
 selectedDept=dashboardQuery.get('department')||'';
 selectedCategory=dashboardQuery.get('category')||'';

 for(const [field,options] of [['severity',classification?.levels],['occurrence',classification?.occurrences]]){
  const control=$(field+'Filter');
  for(const [code,value] of Object.entries(options||{})){
   control.append(new Option(field==='severity'?code+' '+value.name:value.name,code));
  }
  const initial=dashboardQuery.get(field);
  if(options&&Object.hasOwn(options,initial))control.value=initial;
  control.onchange=()=>{page=0;renderRows();};
 }
 $('showSeverityGuide').onclick=()=>classification?.showGuide($('severityGuide'));

 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Bangkok',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const date=Object.fromEntries(parts.map(x=>[x.type,x.value]));
 const today=date.year+'-'+date.month+'-'+date.day;
 $('day').value=today;
 $('month').value=today.slice(0,7);
 $('year').value=date.year;
 $('week').value=weekKey(today);
 $('filter').onchange=updatePeriod;
 for(const kind of periodKinds)$(kind).onchange=updatePeriod;

 status.onchange=()=>{selected=status.value;page=0;renderRows();};
 $('departmentFilter').onchange=event=>{selectedDept=event.target.value;page=0;renderRows();};
 $('categoryFilter').onchange=event=>{selectedCategory=event.target.value;page=0;renderRows();};
 scopes.onchange=()=>{page=0;render();};
 $('dashSearch').oninput=()=>{page=0;render();};
 $('refresh').onclick=load;
 $('prevPage').onclick=()=>{page--;renderRows();};
 $('nextPage').onclick=()=>{page++;renderRows();};
 $('clearAllJobFilters').onclick=()=>{
  $('dashSearch').value='';
  scopes.value=$('filter').value=status.value=selected='all';
  selectedDept=selectedCategory='';
  for(const id of ['departmentFilter','categoryFilter','severityFilter','occurrenceFilter'])$(id).value='';
  showCatalogTopic();
  page=0;render();
 };
 const topic=$('filterTopic');
 topic.value=['category','severity','occurrence','department','status','scope']
  .find(key=>dashboardQuery.has(key))||'search';
 topic.onchange=showCatalogTopic;
 showCatalogTopic();
 $('allJobFilters').hidden=false;
}
function updateCatalogOptions(){
 const departments=new Set(),categories=new Set();
 for(const job of all)for(const assignment of enabledAssignments(job)){
  if(assignment.department)departments.add(assignment.department);
  for(const issue of assignment.issues)if(issue.category_code)categories.add(issue.category_code);
 }
 for(const [id,items,current,labelFor] of [
  ['departmentFilter',departments,selectedDept,code=>code],
  ['categoryFilter',categories,selectedCategory,code=>chartCategoryNames.get(code)||code]
 ]){
  if(current)items.add(current);
  const order=[...items].sort((a,b)=>labelFor(a).localeCompare(labelFor(b),'th'));
  const control=$(id);
  control.replaceChildren(control.options[0],...order.map(code=>new Option(labelFor(code),code)));
  control.value=current;
 }
 renderActiveCatalogFilters();
}
function syncHomeChartSelection(){
 for(const control of document.querySelectorAll('.charts [data-chart-status],.charts [data-chart-dept],.stat')){
  const status=control.dataset.chartStatus||control.dataset.status||'all';
  const department=control.dataset.chartDept||'';
  const active=status===selected&&department===selectedDept;
  control.setAttribute('aria-pressed',String(active));
  control.classList.toggle(control.classList.contains('stat')?'active':'selected',active);
 }
}
function filterHomeFromChart(status='all',department=''){
 const clear=status===selected&&department===selectedDept;
 selected=clear?'all':status;
 selectedDept=clear?'':department;
 page=0;
 syncHomeChartSelection();
 renderRows();
 $('listTitle').scrollIntoView?.({behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'auto':'smooth',block:'nearest'});
}
function bindHomeCharts(){
 document.querySelector('.charts').addEventListener('click',event=>{
  const target=event.target.closest('[data-chart-status],[data-chart-dept]');
  if(target){filterHomeFromChart(target.dataset.chartStatus,target.dataset.chartDept);return;}
  const ring=event.target.closest('#donut');
  if(!ring||event.target.closest('.donut-center'))return;
  const rect=ring.getBoundingClientRect();
  const x=event.clientX-rect.left-rect.width/2,y=event.clientY-rect.top-rect.height/2;
  const distance=Math.hypot(x,y);
  if(distance<rect.width*.32||distance>rect.width*.52)return;
  const angle=((Math.atan2(x,-y)*180/Math.PI+360)%360)/3.6;
  const part=JSON.parse(ring.dataset.parts||'[]').find(p=>angle>=p.from&&angle<p.to);
  if(part)filterHomeFromChart(part.s);
 });
 document.querySelectorAll('.stat').forEach(el=>el.onclick=()=>filterHomeFromChart(el.dataset.status));
}
function init(){
 initExcel();
 const profile=window.QA?.profile||{};
 $('welcome').textContent=`สวัสดี ${profile.display_name||profile.email||'ผู้ใช้งาน'} · ${profile.department||'ระบบติดตามงาน'}`;
 if(allJobsMode){
  initCatalogFilters();
  document.querySelector('main > header h1').textContent='งานทั้งหมด';
  document.title='งานทั้งหมด | Complain & Action Tracking';
  void loadCategoryNames().then(updateCatalogOptions).catch(()=>{});
 }else{
  initIssueSummary();
  bindHomeCharts();
  compactLatest?.addEventListener?.('change',renderRows);
  returningView=window.QAReturn?.takeReturn()||null;
  if(!returningView&&dashboardQuery.get('from')==='all-jobs'){
   const state=window.QAReturn?.readDashboard();
   if(state)returningView={state};
  }
  if(returningView){
   const saved=returningView.state;
   if(statuses.some(([key])=>key===saved?.selected))selected=saved.selected;
   if(typeof saved?.selectedDept==='string')selectedDept=saved.selectedDept;
   window.QAReturn?.showMessage(returningView.message);
  }
  document.addEventListener('click',event=>{
   const link=event.target.closest('a[href]');
   if(!link)return;
   const url=new URL(link.href,location.href);
   if(url.origin===location.origin&&url.pathname===new URL('vnext-job.html',location.href).pathname)rememberDashboard();
  },true);
  $('viewAll').addEventListener('click',rememberDashboard);
  window.addEventListener('pagehide',rememberDashboard);
 }
 load();
}
async function refreshSummary(){const seq=++summaryRequest;
 try{const {data,error}=await window.QA.client.rpc('qa_dashboard_issue_summary',{
  p_scope:'all',p_date_from:null,p_date_to:null});
  if(error)throw error;if(!data||!Array.isArray(data.departments))throw new Error('รูปแบบข้อมูลสถิติไม่ถูกต้อง');
  if(seq!==summaryRequest)return;globalAggregate=data;render();
 }catch(e){if(seq!==summaryRequest)return;globalAggregate=null;render();$('feedback').textContent='โหลดสถิติรวมไม่สำเร็จ: '+String(e?.message||e);}}
async function loadRoleMetadata(jobs,request){
 const pending=jobs.slice(),profile=window.QA.profile;let failures=0;
 const workers=Array.from({length:Math.min(4,pending.length)},async()=>{
  while(pending.length&&request===loadRequest){const job=pending.shift();try{
   const result=await QA.client.rpc('qa_vnext_job_detail',{p_job_id:job.jobId});
   if(request!==loadRequest)return;
   if(result.error||!result.data||!Array.isArray(result.data.assignments)){failures++;continue;}
   const data=result.data;job.isRequester=data.is_requester===true;
   for(const a of job.departmentAssignments){const source=data.assignments.find(x=>String(x.assignment_id)===a.assignmentId);if(!source)continue;
    a.rawStatus=String(source.status||a.rawStatus).toUpperCase();a.chartStatus=groupStatus(a.rawStatus);
    a.approvedAt=source.approved_at||null;a.approvalRequestedAt=source.approval_requested_at||null;
    a.selfReview=a.selfResponse&&a.rawStatus==='IN_PROGRESS'&&Boolean(a.approvalRequestedAt)&&!a.approvedAt;
    a.selfReturned=a.selfResponse&&a.rawStatus==='IN_PROGRESS'&&!a.approvalRequestedAt&&Boolean(source.requester_review_reason);
    if(a.selfReview)a.chartStatus='WAITING_REVIEW';a.responsibleUser=source.responsible_user||null;
    a.unrelatedRequestedAt=source.unrelated_requested_at||null;a.unrelatedDecidedAt=source.unrelated_decided_at||null;a.needsRework=Boolean(source.needs_rework);
    a.metadataLoaded=true;
   }
   // RETURN is recorded in audit history, not in the assignment's rework flag.
   // Read only for receiving departments that may access this internal history.
   if(['user','department_admin'].includes(profile.role)&&job.departmentAssignments.some(a=>norm(a.department)===norm(profile.department)&&a.rawStatus==='IN_PROGRESS'&&!a.approvalRequestedAt&&!a.needsRework)){
    const history=await QA.client.rpc('qa_v38_job_history',{p_job_id:job.jobId});
    if(!history.error&&Array.isArray(history.data))for(const a of job.departmentAssignments){
     if(norm(a.department)!==norm(profile.department))continue;
     const events=history.data.filter(e=>norm(e.department_code)===norm(a.department)&&e.action!=='SAVE_DRAFT').sort((x,y)=>Date.parse(y.created_at)-Date.parse(x.created_at));
     a.returnedFromHead=events[0]?.action==='RETURN';
    }
   }
  }catch{failures++;}}
 });await Promise.all(workers);return failures;
}

// The catalog enriches only the visible page. Its row order uses the issue code.
const catalogRequested=new WeakSet();
let visibleCatalogJobs=[],catalogMetadataRunning=false;
function queueCatalogMetadata(rows){
 visibleCatalogJobs=[...new Set(rows.map(row=>row.job))]
  .filter(job=>job.workflowVisible&&job.departmentAssignments.some(a=>a.assignmentId));
 if(!catalogMetadataRunning)void refreshCatalogMetadata();
}
async function refreshCatalogMetadata(){
 catalogMetadataRunning=true;
 try{
  let jobs;
  while((jobs=visibleCatalogJobs.filter(job=>!catalogRequested.has(job))).length){
   const request=loadRequest;
   const batch=jobs.slice(0,4);
   batch.forEach(job=>catalogRequested.add(job));
   await loadRoleMetadata(batch,request);
   if(request===loadRequest)renderRows();
  }
 }finally{catalogMetadataRunning=false;}
}
async function refreshReceivers(request){
 try{
  const {data,error}=await QA.client.rpc('qa_vnext_receivers',{});
  if(error)throw error;
  if(!Array.isArray(data))throw new Error('Invalid receiver settings response');
  if(request!==loadRequest)return;
  receiverCodes=[...new Set(data.filter(x=>x.enabled===true).map(x=>String(x.code||'').trim()).filter(Boolean))];
  receiverError='';
 }catch(e){if(request!==loadRequest)return;receiverError=e.message||String(e);}
 renderCharts(selectedGlobalCounts());
}
async function load(){
 const request=++loadRequest;
 visibleCatalogJobs=[];
 $('feedback').textContent='กำลังโหลดรายการงานที่มีสิทธิ์ดู...';
 if(!allJobsMode){void refreshReceivers(request);void refreshSummary();}
 try{
   const profile=window.QA?.profile||{};
   const listRpc=allJobsMode?'qa_all_jobs_list_v1':'qa_dashboard_department_issue_list';
   const {data:rows,error:listError}=await window.QA.client.rpc(listRpc);
   if(request!==loadRequest)return;
   if(listError){
    if(allJobsMode&&['PGRST202','42883'].includes(String(listError.code)))throw new Error('กรุณาติดตั้ง SQL ชุดเปิดดูงานทั้งหมด');
    throw new Error('รายการงาน: '+listError.message);
   }
   if(!Array.isArray(rows))throw new Error('รูปแบบรายการแผนกไม่ถูกต้อง');
   const localRole=['user','department_admin'].includes(String(profile.role||'').toLowerCase());
   const department=norm(profile.department);
   if(localRole&&!department)throw new Error('บัญชีผู้ใช้ยังไม่ได้กำหนดแผนก');
   all=rows.map(r=>({
     jobId:String(r.job_id||''),carCode:String(r.car_code||r.job_id||''),
     customerName:String(r.customer_name||''),country:String(r.country||''),
     serialNo:String(r.serial_no||''),fromDepartment:String(r.from_department||''),
     createdDateTime:String(r.created_at||''),createdBy:r.created_by||'',isRequester:r.is_requester===true,workflowVisible:r.workflow_visible===true,
     departmentAssignments:[...(r.assignments||[]),...(allJobsMode&&r.unassigned_issues?.length
       ? [{status:r.status,issues:r.unassigned_issues,workflow_visible:r.workflow_visible}] : [])]
       .filter(a=>allJobsMode||!localRole||norm(r.from_department)===department||norm(a.department_code)===department)
       .map(a=>({department:String(a.department_code||''),assignmentId:String(a.assignment_id||''),
          metadataLoaded:false,selfResponse:a.self_response===true,selfReview:a.self_review_pending===true||(a.self_response===true&&a.status==='IN_PROGRESS'&&Boolean(a.approval_requested_at)),
          selfReturned:a.self_returned===true,workflowVisible:a.workflow_visible===true,isMyWork:a.is_my_work===true,rawStatus:String(a.status||'').toUpperCase(),approvedAt:a.approved_at||null,reviewRound:Number(a.review_round)||null,approvalRequestedAt:a.approval_requested_at||null,unrelatedRequestedAt:a.unrelated_requested_at||null,unrelatedDecidedAt:a.unrelated_decided_at||null,needsRework:Boolean(a.needs_rework),
          chartStatus:a.self_review_pending===true||(a.self_response===true&&a.status==='IN_PROGRESS'&&a.approval_requested_at)?'WAITING_REVIEW':groupStatus(a.status),issues:Array.isArray(a.issues)?a.issues:[]}))
   })).filter(j=>j.departmentAssignments.length>0).sort((a,b)=>dt(b)-dt(a));
   if(allJobsMode)updateCatalogOptions();
   page=0;
   issueReadStates=new Map();
   render();
   if(returningView){const y=Number(returningView.state?.scrollY)||0;requestAnimationFrame(()=>requestAnimationFrame(()=>window.scrollTo({top:Math.max(0,y),behavior:'instant'})));returningView=null;}
   const feedback=()=>'รายการรับเข้าและแจ้งออกที่มีสิทธิ์เข้าถึง '+all.reduce((n,j)=>n+issueRowsFor(j).length,0)+' ปัญหา';
   $('feedback').textContent=allJobsMode?'':feedback();
   void refreshReadStates().then(()=>{if(request===loadRequest)renderRows();}).catch(()=>{});
   if(!allJobsMode){
    const reviewLoadFailures=await loadRoleMetadata(all,request);
    if(request!==loadRequest)return;
    render();
    if(reviewLoadFailures)$('feedback').textContent=feedback()+' · โหลดรายละเอียดสถานะบางรายการไม่สำเร็จ โปรดเปิดใบงานตรวจสอบ';
   }
 }catch(e){
   if(request!==loadRequest)return;
   all=[];base=[];render();
   $('feedback').textContent='โหลดรายการที่มีสิทธิ์ดูไม่สำเร็จ: '+String(e?.message||e);
 }

}

if(!window.QA?.run){document.addEventListener('DOMContentLoaded',()=>{$('feedback').textContent='ไม่พบระบบ API กรุณาตรวจสอบ config.js และ supabase-api.js'});}else document.addEventListener('DOMContentLoaded',()=>{window.QA.whenReady().then(init).catch(e=>{$('feedback').textContent=e?.message||String(e)})});
})();
