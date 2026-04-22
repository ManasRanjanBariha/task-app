
// ====================================================
// DATA MODEL
// ====================================================
// tasks[]        — task definitions
// progressLogs[] — { id, taskId, date, time, value, note }
// missedLogs[]   — { taskId, date, expectedTime, mode, status:'missed'|'done' }
// settings{}     — user preferences
// task.fixedTimes[] — array of "HH:MM" strings (for fixed mode)
// task.completedDates[] — dates where goal was completed (for persistence)

let tasks=[], progressLogs=[], missedLogs=[], settings={};
let reminderTimers={};
let curType='numeric', curReminder='interval';
let fixedTimesEdit=[];

// ====================================================
// STORAGE
// ====================================================
function load(){
  tasks=JSON.parse(localStorage.getItem('tf_tasks')||'[]');
  progressLogs=JSON.parse(localStorage.getItem('tf_logs')||'[]');
  missedLogs=JSON.parse(localStorage.getItem('tf_missed')||'[]');
  settings=JSON.parse(localStorage.getItem('tf_settings')||'{"defaultInterval":2,"defaultUnit":"","notif":false,"sound":false}');
}
function save(){
  localStorage.setItem('tf_tasks',JSON.stringify(tasks));
  localStorage.setItem('tf_logs',JSON.stringify(progressLogs));
  localStorage.setItem('tf_missed',JSON.stringify(missedLogs));
  localStorage.setItem('tf_settings',JSON.stringify(settings));
}

// ====================================================
// DATE / TIME HELPERS
// ====================================================
function today(){return new Date().toISOString().slice(0,10)}
function nowTime(){return new Date().toTimeString().slice(0,5)}
function fmtDate(d){
  const dt=new Date(d+'T00:00:00');
  if(d===today()) return 'Today';
  const y=new Date(); y.setDate(y.getDate()-1);
  if(d===y.toISOString().slice(0,10)) return 'Yesterday';
  return dt.toLocaleDateString('en-IN',{weekday:'short',month:'short',day:'numeric'});
}
function getLast7Days(){
  const days=[];
  for(let i=6;i>=0;i--){
    const d=new Date(); d.setDate(d.getDate()-i);
    days.push(d.toISOString().slice(0,10));
  }
  return days;
}

// ====================================================
// NOTIFICATIONS
// ====================================================
function requestNotifPermission(){
  if(!('Notification' in window)){showToast('Not supported in this browser');return}
  Notification.requestPermission().then(p=>{
    if(p==='granted'){
      settings.notif=true; save(); syncSettingsUI();
      document.getElementById('notifDot').style.display='none';
      showToast('🔔 Notifications enabled!');
    } else showToast('Notifications blocked by browser');
  });
}
function sendNotif(task){
  if(Notification.permission!=='granted'||!settings.notif) return;
  const n=new Notification('TaskFlow 🔔',{body:'Time to log: '+task.title,icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="%236c28d9"/><text y=".9em" font-size="80" x="15">✦</text></svg>'});
  n.onclick=()=>{window.focus();openLogModal(task.id);n.close()};
  if(settings.sound) playBeep();
}
function playBeep(){
  try{
    const ac=new(window.AudioContext||window.webkitAudioContext)();
    const o=ac.createOscillator(); const g=ac.createGain();
    o.connect(g); g.connect(ac.destination);
    o.frequency.value=880; g.gain.value=0.1;
    o.start(); g.gain.exponentialRampToValueAtTime(.0001,ac.currentTime+.4);
    o.stop(ac.currentTime+.4);
  } catch(e){}
}

// ====================================================
// PROGRESS HELPERS
// ====================================================
function getLogsFor(taskId,date){return progressLogs.filter(l=>l.taskId===taskId&&l.date===date)}
function getTodayTotal(task){
  if(task.type!=='numeric') return null;
  return getLogsFor(task.id,today()).reduce((s,l)=>s+(parseFloat(l.value)||0),0);
}
function isGoalDone(task,date){
  date=date||today();
  if(task.completedDates&&task.completedDates.includes(date)) return true;
  if(task.type!=='numeric'||!task.target) return false;
  const total=getLogsFor(task.id,date).reduce((s,l)=>s+(parseFloat(l.value)||0),0);
  return total>=parseFloat(task.target);
}
function getStreak(taskId){
  const logDates=[...new Set(progressLogs.filter(l=>l.taskId===taskId).map(l=>l.date))].sort().reverse();
  if(!logDates.length) return 0;
  let streak=0, d=new Date();
  for(let i=0;i<365;i++){
    const ds=d.toISOString().slice(0,10);
    if(logDates.includes(ds)){streak++;d.setDate(d.getDate()-1)}
    else if(i===0){d.setDate(d.getDate()-1)}
    else break;
  }
  return streak;
}

// ====================================================
// MISSED REMINDER TRACKING (FIX #2)
// ====================================================
function recordMissedReminder(task, expectedTime){
  const existing=missedLogs.find(m=>m.taskId===task.id&&m.date===today()&&m.expectedTime===expectedTime);
  if(existing) return;
  if(isGoalDone(task)) return;
  // Check if user logged AFTER this expected time
  const logs=getLogsFor(task.id,today());
  const loggedAfter=logs.some(l=>l.time>=expectedTime);
  const status=loggedAfter?'done':'missed';
  missedLogs.push({taskId:task.id,date:today(),expectedTime,mode:task.reminder.mode,status});
  save();
}
function getMissedTodayCount(){
  return missedLogs.filter(m=>m.date===today()&&m.status==='missed').length;
}
function getMissedTasks(){
  const taskIds=[...new Set(missedLogs.filter(m=>m.date===today()&&m.status==='missed').map(m=>m.taskId))];
  return tasks.filter(t=>taskIds.includes(t.id));
}
function checkMissedForTask(task){
  return missedLogs.some(m=>m.taskId===task.id&&m.date===today()&&m.status==='missed');
}

// ====================================================
// REMINDERS (FIX #4 — multiple fixed times, FIX #5 — persist completion)
// ====================================================
function setupReminders(){
  Object.values(reminderTimers).forEach(t=>{clearInterval(t);clearTimeout(t)});
  reminderTimers={};
  tasks.forEach(task=>{
    if(!task.reminder||task.reminder.mode==='none') return;
    if(isGoalDone(task)) return;
    if(task.reminder.mode==='interval'){
      const ms=(parseFloat(task.reminder.value)||2)*3600000;
      reminderTimers[task.id]=setInterval(()=>{
        if(isGoalDone(task)){clearInterval(reminderTimers[task.id]);return}
        const expTime=nowTime();
        recordMissedReminder(task,expTime);
        sendNotif(task);
        if(document.visibilityState==='visible') openLogModal(task.id);
        renderDashboard();
      },ms);
    } else if(task.reminder.mode==='fixed'){
      scheduleFixed(task);
    }
  });
  // minute ticker for fixed times + missed detection
  if(reminderTimers['__minute__']) clearInterval(reminderTimers['__minute__']);
  reminderTimers['__minute__']=setInterval(()=>{
    const now=nowTime();
    tasks.forEach(task=>{
      if(task.reminder&&task.reminder.mode==='fixed'&&!isGoalDone(task)){
        const times=task.fixedTimes||[];
        if(times.includes(now)){
          recordMissedReminder(task,now);
          sendNotif(task);
          if(document.visibilityState==='visible') openLogModal(task.id);
        }
      }
    });
    // Interval missed detection: check if last log > interval*1.5 hours ago
    tasks.forEach(task=>{
      if(task.reminder&&task.reminder.mode==='interval'&&!isGoalDone(task)){
        const logs=getLogsFor(task.id,today());
        if(logs.length){
          const last=logs[logs.length-1];
          const elapsed=(Date.now()-new Date(today()+'T'+last.time))/3600000;
          const interval=parseFloat(task.reminder.value)||2;
          if(elapsed>interval*1.2){
            const expTime=new Date(today()+'T'+last.time);
            expTime.setHours(expTime.getHours()+interval);
            const expStr=expTime.toTimeString().slice(0,5);
            recordMissedReminder(task,expStr);
          }
        }
      }
    });
    if(document.getElementById('screen-dashboard').classList.contains('active')) renderDashboard();
  },60000);
}
function scheduleFixed(task){}

// ====================================================
// SCREEN ROUTING
// ====================================================
function showScreen(name){
  document.querySelectorAll('.screen').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById('screen-'+name).classList.add('active');
  const navEl=document.getElementById('nav-'+name);
  if(navEl) navEl.classList.add('active');
  document.getElementById('fabBtn').style.display=(name==='add'||name==='settings')?'none':'flex';
  if(name==='dashboard') renderDashboard();
  if(name==='history') renderHistory();
  if(name==='stats') renderStats();
  if(name==='settings') syncSettingsUI();
}

// ====================================================
// DASHBOARD (FIX #1 — improved summary)
// ====================================================
function renderDashboard(){
  const date=new Date().toLocaleDateString('en-IN',{weekday:'long',month:'long',day:'numeric'});
  document.getElementById('headerDate').textContent=date;

  const done=tasks.filter(t=>isGoalDone(t)||(t.type==='descriptive'&&getLogsFor(t.id,today()).length>0)).length;
  document.getElementById('sumDone').textContent=done;
  document.getElementById('sumTotal').textContent='/'+tasks.length;
  document.getElementById('sumCap').textContent=tasks.length
    ?`${done} of ${tasks.length} tasks done today`
    :'Add your first task!';

  const best=tasks.length?Math.max(...tasks.map(t=>getStreak(t.id))):0;
  document.getElementById('bestStreak').textContent=best;

  const missedCnt=getMissedTodayCount();
  const missedEl=document.getElementById('missedCount');
  missedEl.textContent=missedCnt>0?`⚠️ ${missedCnt} missed reminders`:'';

  const missedTasks=getMissedTasks();
  const banner=document.getElementById('missedBanner');
  if(missedTasks.length){
    banner.innerHTML=`<div class="missed-banner"><i class="fa fa-triangle-exclamation"></i><div><b>${missedTasks.length} task(s) with missed reminders today:</b> ${missedTasks.map(t=>t.title).join(', ')}</div></div>`;
  } else banner.innerHTML='';

  const container=document.getElementById('dashTasks');
  if(!tasks.length){
    container.innerHTML=`<div class="empty-state"><i class="fa fa-list-check"></i><p>No tasks yet.<br>Tap <b>+</b> to create one!</p></div>`;
    return;
  }
  container.innerHTML=tasks.map(task=>{
    const streak=getStreak(task.id);
    const done=isGoalDone(task);
    const missed=checkMissedForTask(task);
    const logs=getLogsFor(task.id,today());
    let progressHTML='',sub='';
    if(task.type==='numeric'){
      const cur=getTodayTotal(task)||0;
      const tgt=parseFloat(task.target)||0;
      const pct=tgt?Math.min(100,Math.round(cur/tgt*100)):0;
      sub=`${cur}${task.unit?' '+task.unit:''} / ${tgt}${task.unit?' '+task.unit:''}`;
      progressHTML=`
        <div class="d-flex justify-content-between mb-1" style="font-size:.72rem">
          <span style="color:var(--muted)">Progress</span>
          <span style="color:var(--p1);font-weight:700">${sub} (${pct}%)</span>
        </div>
        <div class="progress"><div class="progress-bar" style="width:${pct}%"></div></div>`;
    } else {
      progressHTML=`<div style="font-size:.75rem;color:var(--muted)">${logs.length?logs.length+' entries today':'No entries yet'}</div>`;
    }
    const remTag=task.reminder&&task.reminder.mode!=='none'
      ?`<span class="tag tag-reminder"><i class="fa fa-bell"></i>${task.reminder.mode==='interval'?'Every '+task.reminder.value+'h':(task.fixedTimes||[]).length+' times'}</span>`:'';
    const stTag=streak>0?`<span class="tag tag-streak"><i class="fa fa-fire"></i>${streak}d</span>`:'';
    const miTag=missed?`<span class="tag tag-missed"><i class="fa fa-triangle-exclamation"></i>Missed</span>`:'';
    const dnTag=done?`<span class="tag tag-done"><i class="fa fa-circle-check"></i>Done!</span>`:'';
    return `<div class="task-card" onclick="handleTap('${task.id}')">
      <div class="d-flex justify-content-between align-items-start mb-2">
        <div style="flex:1;min-width:0;margin-right:8px">
          <div class="task-title">${task.title}</div>
          <span class="type-badge ${task.type==='numeric'?'badge-num':'badge-desc'} me-1">${task.type==='numeric'?'#':'✎'} ${task.type}</span>
        </div>
        <div class="d-flex align-items-center gap-1">
          <button class="edit-icon-btn" onclick="event.stopPropagation();openEditTask('${task.id}')"><i class="fa fa-pen-to-square"></i></button>
          <button class="log-btn" ${done?'disabled':''} onclick="event.stopPropagation();openLogModal('${task.id}')">${done?'Done ✓':'+ Log'}</button>
        </div>
      </div>
      <div class="mb-2">${progressHTML}</div>
      <div class="d-flex flex-wrap gap-1">${remTag}${stTag}${miTag}${dnTag}</div>
    </div>`;
  }).join('');
}
function handleTap(taskId){
  const t=tasks.find(x=>x.id===taskId);
  if(!t||isGoalDone(t)) return;
  openLogModal(taskId);
}

// ====================================================
// TODAY SUMMARY MODAL (FIX #1 complete)
// ====================================================
function openTodaySummary(){
  document.getElementById('sumModalDate').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',month:'long',day:'numeric'});
  const missedCnt=getMissedTodayCount();
  let html='';
  if(!tasks.length){html='<div class="empty-state" style="padding:24px"><i class="fa fa-chart-pie"></i><p>No tasks yet</p></div>';}
  else {
    html=tasks.map(task=>{
      const logs=getLogsFor(task.id,today());
      let valStr='', statusStr='', statusColor=var_('--muted');
      if(task.type==='numeric'){
        const cur=getTodayTotal(task)||0;
        const tgt=parseFloat(task.target)||0;
        valStr=`${cur}${task.unit?' '+task.unit:''} / ${tgt}${task.unit?' '+task.unit:''}`;
        const done=isGoalDone(task);
        statusStr=done?'✅ Goal met':(cur>0?`${Math.round(cur/tgt*100)}% done`:'Not started');
      } else {
        valStr=`${logs.length} entries`;
        statusStr=logs.length>0?'✅ Logged':'Not started';
      }
      const missed=checkMissedForTask(task)?'<span class="tag tag-missed ms-1"><i class="fa fa-triangle-exclamation"></i>Missed</span>':'';
      return `<div class="sum-task-row">
        <div><div class="sum-task-name">${task.title} ${missed}</div><div class="sum-task-status">${statusStr}</div></div>
        <div class="sum-task-val">${valStr}</div>
      </div>`;
    }).join('');
    html+=`<div style="margin-top:12px;padding:10px 0;border-top:2px solid var(--p5);font-size:.8rem;color:var(--muted)">
      <b style="color:var(--dark)">Missed reminders today: </b><span style="color:${missedCnt>0?'#dc2626':'#16a34a'}">${missedCnt}</span>
    </div>`;
  }
  document.getElementById('sumModalBody').innerHTML=html;
  document.getElementById('summaryModal').classList.add('show');
}
function var_(name){ return getComputedStyle(document.documentElement).getPropertyValue(name); }

// ====================================================
// ADD / EDIT TASK (FIX #4 — multiple fixed times)
// ====================================================
function openAddTask(){
  document.getElementById('editId').value='';
  document.getElementById('taskTitle').value='';
  document.getElementById('taskTarget').value='';
  document.getElementById('taskUnit').value=settings.defaultUnit||'';
  document.getElementById('intervalVal').value=settings.defaultInterval||2;
  document.getElementById('delBtn').style.display='none';
  document.getElementById('addTitle').textContent='New Task';
  fixedTimesEdit=[];
  renderTimeChips();
  selType('numeric'); selReminder('interval');
  showScreen('add');
}
function openEditTask(taskId){
  const t=tasks.find(x=>x.id===taskId); if(!t) return;
  document.getElementById('editId').value=t.id;
  document.getElementById('taskTitle').value=t.title;
  document.getElementById('taskTarget').value=t.target||'';
  document.getElementById('taskUnit').value=t.unit||'';
  document.getElementById('addTitle').textContent='Edit Task';
  document.getElementById('delBtn').style.display='block';
  fixedTimesEdit=[...(t.fixedTimes||[])];
  renderTimeChips();
  selType(t.type);
  if(t.reminder){
    selReminder(t.reminder.mode);
    if(t.reminder.mode==='interval') document.getElementById('intervalVal').value=t.reminder.value||2;
  } else selReminder('none');
  showScreen('add');
}
function selType(t){
  curType=t;
  ['numeric','descriptive'].forEach(x=>{
    document.getElementById('btn'+x.charAt(0).toUpperCase()+x.slice(1)).className='tgl-btn'+(x===t?' sel':'');
  });
  document.getElementById('numericFields').style.display=t==='numeric'?'block':'none';
}
function selReminder(m){
  curReminder=m;
  document.getElementById('btnInterval').className='tgl-btn'+(m==='interval'?' sel':'');
  document.getElementById('btnFixed').className='tgl-btn'+(m==='fixed'?' sel':'');
  document.getElementById('btnNone').className='tgl-btn'+(m==='none'?' sel':'');
  document.getElementById('intervalField').style.display=m==='interval'?'block':'none';
  document.getElementById('fixedField').style.display=m==='fixed'?'block':'none';
}
function addFixedTime(){
  const v=document.getElementById('newTimeInput').value;
  if(!v){showToast('Pick a time first');return}
  if(fixedTimesEdit.includes(v)){showToast('Already added');return}
  fixedTimesEdit.push(v);
  fixedTimesEdit.sort();
  document.getElementById('newTimeInput').value='';
  renderTimeChips();
}
function removeFixedTime(t){fixedTimesEdit=fixedTimesEdit.filter(x=>x!==t);renderTimeChips()}
function renderTimeChips(){
  document.getElementById('timeChips').innerHTML=fixedTimesEdit.map(t=>
    `<span class="time-chip">${t}<button onclick="removeFixedTime('${t}')"><i class="fa fa-xmark"></i></button></span>`
  ).join('');
}
function saveTask(){
  const title=document.getElementById('taskTitle').value.trim();
  if(!title){showToast('Enter a task title');return}
  if(curReminder==='fixed'&&fixedTimesEdit.length===0){showToast('Add at least one reminder time');return}
  const editId=document.getElementById('editId').value;
  const existing=tasks.find(t=>t.id===editId);
  const reminder=curReminder==='interval'
    ?{mode:'interval',value:parseFloat(document.getElementById('intervalVal').value)||2}
    :curReminder==='fixed'
    ?{mode:'fixed',value:fixedTimesEdit[0]}
    :{mode:'none'};
  const taskData={
    id:editId||'task_'+Date.now(),
    title,type:curType,
    target:curType==='numeric'?(parseFloat(document.getElementById('taskTarget').value)||0):null,
    unit:document.getElementById('taskUnit').value.trim(),
    reminder,
    fixedTimes:curReminder==='fixed'?[...fixedTimesEdit]:[],
    completedDates:existing?existing.completedDates||[]:[], // persist completion (FIX #5)
    createdAt:existing?existing.createdAt:new Date().toISOString()
  };
  if(editId){const i=tasks.findIndex(t=>t.id===editId);tasks[i]=taskData}
  else tasks.push(taskData);
  save(); setupReminders();
  showToast(editId?'✅ Task updated!':'✅ Task created!');
  showScreen('dashboard');
}
function deleteTask(){
  const id=document.getElementById('editId').value; if(!id) return;
  if(!confirm('Delete this task? All logs will be removed.')) return;
  tasks=tasks.filter(t=>t.id!==id);
  progressLogs=progressLogs.filter(l=>l.taskId!==id);
  missedLogs=missedLogs.filter(m=>m.taskId!==id);
  save(); setupReminders();
  showToast('🗑️ Task deleted');
  showScreen('dashboard');
}

// ====================================================
// LOG MODAL
// ====================================================
function openLogModal(taskId){
  const task=tasks.find(t=>t.id===taskId); if(!task) return;
  document.getElementById('logTaskId').value=taskId;
  document.getElementById('logTitle').textContent='Log: '+task.title;
  document.getElementById('logVal').value='';
  document.getElementById('logNote').value='';
  document.getElementById('logExtra').value='';
  if(task.type==='numeric'){
    document.getElementById('numLogArea').style.display='block';
    document.getElementById('descLogArea').style.display='none';
    const cur=getTodayTotal(task)||0;
    const tgt=parseFloat(task.target)||0;
    const rem=Math.max(0,tgt-cur);
    document.getElementById('logSub').textContent=`Today: ${cur}${task.unit?' '+task.unit:''} / ${tgt}${task.unit?' '+task.unit:''}`;
    const presets=[...new Set([5,10,15,20,rem].filter(v=>v>0))].sort((a,b)=>a-b);
    document.getElementById('quickBtns').innerHTML=presets.map(v=>
      `<button class="qbtn" onclick="document.getElementById('logVal').value=${v}">${v}${task.unit?' '+task.unit:''}</button>`
    ).join('');
  } else {
    document.getElementById('numLogArea').style.display='none';
    document.getElementById('descLogArea').style.display='block';
    document.getElementById('logSub').textContent='What did you do today?';
  }
  document.getElementById('logModal').classList.add('show');
}
function closeModal(id){document.getElementById(id).classList.remove('show')}
function submitLog(){
  const taskId=document.getElementById('logTaskId').value;
  const task=tasks.find(t=>t.id===taskId); if(!task) return;
  let value=null, note='';
  if(task.type==='numeric'){
    value=parseFloat(document.getElementById('logVal').value);
    if(isNaN(value)||value<=0){showToast('Enter a valid value');return}
    note=document.getElementById('logExtra').value.trim();
  } else {
    note=document.getElementById('logNote').value.trim();
    if(!note){showToast('Please write a note');return}
    note+=(document.getElementById('logExtra').value.trim()?(' — '+document.getElementById('logExtra').value.trim()):'');
  }
  progressLogs.push({id:'log_'+Date.now(),taskId,date:today(),time:nowTime(),value,note});

  // FIX #5: persist completion flag
  if(task.type==='numeric'&&isGoalDone(task)){
    if(!task.completedDates) task.completedDates=[];
    if(!task.completedDates.includes(today())) task.completedDates.push(today());
    // Stop reminders
    if(reminderTimers[task.id]) clearInterval(reminderTimers[task.id]);
    if(reminderTimers['fixed_'+task.id]) clearInterval(reminderTimers['fixed_'+task.id]);
  }
  save();
  closeModal('logModal');
  showToast('📝 Progress saved!');
  renderDashboard();
  if(task.type==='numeric'&&isGoalDone(task)) setTimeout(()=>showToast('🎉 Goal achieved for '+task.title+'!'),500);
}

// ====================================================
// HISTORY
// ====================================================
function renderHistory(){
  const filter=document.getElementById('histFilter');
  filter.innerHTML='<option value="">All Tasks</option>'+tasks.map(t=>`<option value="${t.id}"${filter.value===t.id?' selected':''}>${t.title}</option>`).join('');
  const sel=filter.value;
  let logs=sel?progressLogs.filter(l=>l.taskId===sel):[...progressLogs];
  logs.sort((a,b)=>b.date.localeCompare(a.date)||b.time.localeCompare(a.time));
  if(!logs.length){
    document.getElementById('histContainer').innerHTML=`<div class="empty-state"><i class="fa fa-clock-rotate-left"></i><p>No history yet.<br>Start logging!</p></div>`;
    return;
  }
  const byDate={};
  logs.forEach(l=>{if(!byDate[l.date])byDate[l.date]=[];byDate[l.date].push(l)});
  document.getElementById('histContainer').innerHTML=Object.entries(byDate).map(([date,entries])=>`
    <div style="margin:0 14px 10px">
      <div class="hist-date-hdr">${fmtDate(date)}</div>
      ${entries.map(e=>{
        const task=tasks.find(t=>t.id===e.taskId);
        return `<div class="hist-entry">
          <div class="d-flex justify-content-between"><span class="hist-task">${task?task.title:'Unknown'}</span><span class="hist-time">${e.time}</span></div>
          <div class="hist-val">${e.value!=null?`<b>${e.value}</b>${task&&task.unit?' '+task.unit:''}`:''} ${e.note?`<span style="color:var(--muted)">— ${e.note}</span>`:''}</div>
        </div>`;
      }).join('')}
    </div>`).join('');
}

// ====================================================
// STATS (FIX #6 — weekly trends + task performance)
// ====================================================
function renderStats(){
  // Overall stats
  const totalLogs=progressLogs.length;
  const totalDays=[...new Set(progressLogs.map(l=>l.date))].length;
  const bestStreak=tasks.length?Math.max(...tasks.map(t=>getStreak(t.id))):0;
  const todayMissed=getMissedTodayCount();
  document.getElementById('statsGrid').innerHTML=`
    <div class="stat-card"><div class="stat-big">${totalLogs}</div><div class="stat-lbl">Total Logs</div></div>
    <div class="stat-card"><div class="stat-big">${totalDays}</div><div class="stat-lbl">Active Days</div></div>
    <div class="stat-card"><div class="stat-big">${bestStreak}</div><div class="stat-lbl">Best Streak</div></div>
    <div class="stat-card"><div class="stat-big" style="color:#dc2626">${todayMissed}</div><div class="stat-lbl">Missed Today</div></div>`;

  // Weekly bars
  const last7=getLast7Days();
  const dayCounts=last7.map(d=>progressLogs.filter(l=>l.date===d).length);
  const maxCount=Math.max(...dayCounts,1);
  const dayNames=['S','M','T','W','T','F','S'];
  document.getElementById('weeklyBars').innerHTML=last7.map((d,i)=>{
    const cnt=dayCounts[i];
    const h=Math.round((cnt/maxCount)*70);
    const isToday=d===today();
    return `<div class="bar-col ${isToday?'bar-today':''}">
      <div style="font-size:.62rem;color:var(--p1);font-weight:700">${cnt||''}</div>
      <div class="bar-fill" style="height:${h||3}px"></div>
      <div class="bar-day">${isToday?'<b>T</b>':new Date(d+'T00:00:00').toLocaleDateString('en-IN',{weekday:'narrow'})}</div>
    </div>`;
  }).join('');

  // Task performance
  if(!tasks.length){
    document.getElementById('taskPerf').innerHTML='<div style="font-size:.82rem;color:var(--muted);text-align:center;padding:12px">No tasks yet</div>';
    return;
  }
  const last7Set=new Set(last7);
  document.getElementById('taskPerf').innerHTML=tasks.map(task=>{
    const logsLast7=progressLogs.filter(l=>l.taskId===task.id&&last7Set.has(l.date));
    let pct=0,valStr='';
    if(task.type==='numeric'){
      const weekTotal=logsLast7.reduce((s,l)=>s+(parseFloat(l.value)||0),0);
      const weekTarget=(parseFloat(task.target)||0)*7;
      pct=weekTarget?Math.min(100,Math.round(weekTotal/weekTarget*100)):0;
      valStr=`${pct}%`;
    } else {
      const days=[...new Set(logsLast7.map(l=>l.date))].length;
      pct=Math.round(days/7*100);
      valStr=`${days}/7d`;
    }
    return `<div class="perf-row">
      <div class="perf-name">${task.title}</div>
      <div class="perf-bar-wrap"><div class="perf-bar" style="width:${pct}%"></div></div>
      <div class="perf-val">${valStr}</div>
    </div>`;
  }).join('');
}

// ====================================================
// SETTINGS (FIX #7)
// ====================================================
function syncSettingsUI(){
  document.getElementById('setNotif').checked=!!settings.notif;
  document.getElementById('setSound').checked=!!settings.sound;
  document.getElementById('setDefaultInterval').value=settings.defaultInterval||2;
  document.getElementById('setDefaultUnit').value=settings.defaultUnit||'';
  if(settings.notif) document.getElementById('notifDot').style.display='none';
}
function saveSettings(){
  settings.notif=document.getElementById('setNotif').checked;
  settings.sound=document.getElementById('setSound').checked;
  settings.defaultInterval=parseFloat(document.getElementById('setDefaultInterval').value)||2;
  settings.defaultUnit=document.getElementById('setDefaultUnit').value.trim();
  if(settings.notif&&Notification.permission!=='granted') requestNotifPermission();
  save();
  showToast('Settings saved');
}
function exportData(){
  const data={tasks,progressLogs,missedLogs,settings,exported:new Date().toISOString()};
  const a=document.createElement('a');
  a.href='data:application/json,'+encodeURIComponent(JSON.stringify(data,null,2));
  a.download='taskflow-data.json'; a.click();
}
function clearAllData(){
  if(!confirm('Clear ALL data? This cannot be undone.')) return;
  tasks=[]; progressLogs=[]; missedLogs=[];
  settings={defaultInterval:2,defaultUnit:'',notif:false,sound:false};
  save(); showToast('All data cleared'); showScreen('dashboard');
}

// ====================================================
// TOAST
// ====================================================
function showToast(msg){
  const tc=document.getElementById('toastContainer');
  const el=document.createElement('div'); el.className='toast-msg'; el.textContent=msg;
  tc.appendChild(el); setTimeout(()=>el.remove(),3000);
}

// ====================================================
// INIT
// ====================================================
function init(){
  load();
  document.getElementById('headerDate').textContent=new Date().toLocaleDateString('en-IN',{weekday:'long',month:'long',day:'numeric'});
  if(Notification.permission==='granted') document.getElementById('notifDot').style.display='none';
  ['logModal','summaryModal'].forEach(id=>{
    document.getElementById(id).addEventListener('click',function(e){if(e.target===this)closeModal(id)});
  });
  renderDashboard();
  setupReminders();
}
init();