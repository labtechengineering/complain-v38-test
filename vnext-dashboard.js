(()=>{'use strict';const $=id=>document.getElementById(id);let rows=[],lastLabel='ทั้งหมด';
const colors=['#F59E0B','#3B82F6','#16A34A'];
const num=v=>Number(v)||0;
async function rpc(name,args){const {data,error}=await QA.client.rpc(name,args);if(error)throw error;return data;}
function dateStr(d){return d.toISOString().slice(0,10);}
function bangkokNow(){return new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Bangkok'}));}
function initFilter(){const d=bangkokNow(),iso=dateStr(new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())));$('day').value=iso;$('month').value=iso.slice(0,7);$('year').value=d.getFullYear();
 const utc=new Date(iso+'T00:00:00Z');const wd=utc.getUTCDay()||7;utc.setUTCDate(utc.getUTCDate()+4-wd);
 const jan=new Date(Date.UTC(utc.getUTCFullYear(),0,1));const wk=Math.ceil((((utc-jan)/86400000)+1)/7);
 $('week').value=`${utc.getUTCFullYear()}-W${String(wk).padStart(2,'0')}`;
 $('filter').onchange=toggle;toggle();$('refresh').onclick=refresh;$('download').onclick=download;}
function toggle(){for(const id of ['week','day','month','year'])$(id).hidden=id!==$('filter').value;}
function range(){const mode=$('filter').value;
 if(mode==='all')return null;
 let start,end;
 if(mode==='day'){const s=$('day').value;if(!/^\d{4}-\d{2}-\d{2}$/.test(s))throw new Error('เลือกวันที่');start=new Date(s+'T00:00:00Z');end=new Date(start);end.setUTCDate(end.getUTCDate()+1);lastLabel='วันที่ '+s;}
 if(mode==='week'){const m=/^(\d{4})-W(\d{2})$/.exec($('week').value);if(!m)throw new Error('เลือกสัปดาห์');
 start=new Date(Date.UTC(+m[1],0,4));const dow=start.getUTCDay()||7;start.setUTCDate(start.getUTCDate()-dow+1+(+m[2]-1)*7);
 end=new Date(start);end.setUTCDate(start.getUTCDate()+6);lastLabel='สัปดาห์ '+dateStr(start)+' ถึง '+dateStr(new Date(end.getTime()-86400000));}
 if(mode==='month'){const m=/^(\d{4})-(\d{2})$/.exec($('month').value);if(!m)throw new Error('เลือกเดือน');start=new Date(Date.UTC(+m[1],+m[2]-1,1));end=new Date(Date.UTC(+m[1],+m[2],1));lastLabel='เดือน '+$('month').value;}
 if(mode==='year'){const y=+$('year').value;if(y<2020||y>2100)throw new Error('ปีไม่ถูกต้อง');start=new Date(Date.UTC(y,0,1));end=new Date(Date.UTC(y+1,0,1));lastLabel='ปี '+y;}
 // Endpoints interpret Thailand local midnight, not browser/UTC local midnight.
 function offset(d){return dateStr(d)+'T00:00:00+07:00';}
 return {p_start:offset(start),p_end:offset(end)};}
async function refresh(){try{$('feedback').textContent='กำลังโหลดข้อมูล...';let args=range(),data;
 if(!args){lastLabel='ทั้งหมด ณ '+new Date().toLocaleString('th-TH',{timeZone:'Asia/Bangkok'});data=await rpc('qa_vnext_all_time_summary',{});}
 else data=await rpc('qa_vnext_period_summary',args);
 if(!Array.isArray(data))throw new Error('Dashboard data invalid');rows=data;$('period').textContent=lastLabel;render();$('feedback').textContent='ข้อมูลจาก Supabase · นับหนึ่งเลขงานต่อหนึ่งฝ่ายรับเรื่อง · ไม่รวมงานยกเลิก';
 }catch(e){$('feedback').textContent='โหลด Dashboard ไม่สำเร็จ: '+e.message;$('feedback').className='warning';}}
function render(){const sum=key=>rows.reduce((a,r)=>a+num(r[key]),0);
 $('nTotal').textContent=sum('total').toLocaleString();$('nProgress').textContent=sum('in_progress').toLocaleString();$('nReview').textContent=sum('waiting_review').toLocaleString();$('nDone').textContent=sum('completed').toLocaleString();
 const plot=$('plot'),axis=$('axis');plot.replaceChildren();axis.replaceChildren();const top=Math.max(1,...rows.map(r=>num(r.total)));const max=Math.max(5,Math.ceil(top/5)*5);
 for(let t=4;t>=0;t--){const el=document.createElement('span');el.textContent=Math.round(max*t/4);axis.append(el);}
 if(!rows.length){plot.textContent='ยังไม่ได้กำหนดฝ่ายรับเรื่องใน Settings';return;}
 for(const r of rows){const item=document.createElement('div');item.className='item';const values=[num(r.in_progress),num(r.waiting_review),num(r.completed)],total=num(r.total);
 const totals=document.createElement('div');totals.className='total';totals.textContent=total||'0';
 const column=document.createElement('div');column.className='columns';column.style.height=(280*total/max)+'px';
 values.forEach((n,i)=>{if(n===0)return;const segment=document.createElement('div');segment.className='segment';segment.style.background=colors[i];segment.style.flex=n;segment.title=n+' งาน';segment.textContent=n;column.append(segment);});
 const label=document.createElement('div');label.className='dept';label.textContent=r.department_name||r.department_code;
 item.append(totals,column,label);plot.append(item);}}
function draw(){const data=rows,canvas=document.createElement('canvas');const width=Math.max(1080,180+data.length*140),height=760,scale=2;canvas.width=width*scale;canvas.height=height*scale;
 const c=canvas.getContext('2d');c.scale(scale,scale);c.fillStyle='#fff';c.fillRect(0,0,width,height);c.fillStyle='#172337';c.font='bold 28px Arial';c.fillText('Complain Dashboard',36,51);c.font='16px Arial';c.fillStyle='#526277';c.fillText(lastLabel,36,82);
 const labels=['งานทั้งหมด','กำลังดำเนินงาน','รอตรวจสอบ','สำเร็จ'],keys=['total','in_progress','waiting_review','completed'];
 keys.forEach((key,i)=>{const x=36+i*(width-72)/4,w=(width-72)/4-12;c.fillStyle='#f1f5f9';c.fillRect(x,110,w,116);c.fillStyle='#172337';c.font='15px Arial';c.fillText(labels[i],x+13,138);c.font='bold 36px Arial';c.fillText(String(data.reduce((a,r)=>a+num(r[key]),0)),x+13,193);});
 c.font='bold 23px Arial';c.fillStyle='#172337';c.fillText('จำนวนงานแยกตามฝ่ายรับเรื่อง',36,278);
 let lx=36;['กำลังดำเนินงาน','รอตรวจสอบ','สำเร็จ'].forEach((label,i)=>{c.fillStyle=colors[i];c.fillRect(lx,302,13,13);c.fillStyle='#344054';c.font='14px Arial';c.fillText(label,lx+18,314);lx+=155;});
 const left=80,top=350,base=672,chartW=width-120,max=Math.max(5,Math.ceil(Math.max(1,...data.map(r=>num(r.total)))/5)*5);
 for(let i=0;i<=4;i++){const y=base-(base-top)*i/4;c.strokeStyle='#e3e8ed';c.beginPath();c.moveTo(left,y);c.lineTo(width-32,y);c.stroke();c.fillStyle='#64748b';c.fillText(String(Math.round(max*i/4)),30,y+5);}
 data.forEach((r,i)=>{const bw=Math.min(75,chartW/(Math.max(1,data.length)*1.7)),x=left+(i+.5)*chartW/data.length-bw/2;
 let y=base;[num(r.in_progress),num(r.waiting_review),num(r.completed)].forEach((v,j)=>{if(!v)return;const h=(base-top)*v/max;y-=h;c.fillStyle=colors[j];c.fillRect(x,y,bw,h);if(h>=18){c.fillStyle='#fff';c.font='bold 14px Arial';c.textAlign='center';c.fillText(String(v),x+bw/2,y+h/2+5);c.textAlign='left';}});
 c.fillStyle='#172337';c.font='bold 14px Arial';c.textAlign='center';c.fillText(String(num(r.total)),x+bw/2,y-8);
 c.font='13px Arial';c.fillText(String(r.department_name||r.department_code).slice(0,20),x+bw/2,base+27);c.textAlign='left';});
 c.fillStyle='#64748b';c.font='12px Arial';c.fillText('งานทั้งหมด ณ เวลาที่สร้างรายงาน · จำนวนหนึ่งงานต่อหนึ่งฝ่ายรับเรื่อง',36,737);return canvas;}
function download(){if(!rows.length)return;const c=draw(),a=document.createElement('a');a.href=c.toDataURL('image/png');a.download='Complain_Dashboard_'+new Date().toISOString().slice(0,10)+'.png';a.click();}
// Expose the same canvas renderer for optional authenticated image reporting.
window.QAVNextDashboard={renderCanvas:draw};
async function boot(){for(let i=0;i<160&&!QA.profile;i++)await new Promise(r=>setTimeout(r,100));if(!QA.profile){$('feedback').textContent='กรุณาเข้าสู่ระบบ';return;}initFilter();await refresh();}
boot();
})();
