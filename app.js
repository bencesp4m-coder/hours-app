(function(){
  const STORE_KEY = 'workTrackerData_v1';
  const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
  const CURRENCY_SYMBOLS = { USD:'$', EUR:'€', CAD:'$', HUF:'Ft' };

  function defaultData(){
    const today = fmtDate(new Date());
    return {
      settings: {
        monthlyGoalHours: 30,
        startDate: today,
        hourlyWage: 0,
        currency: 'EUR',
        financialGoal: 0,
        name: ''
      },
      days: {},
      running: { active:false, startTs:null, date:null },
      meta: { updatedAt: Date.now() }
    };
  }

  function load(){
    try{
      const raw = localStorage.getItem(STORE_KEY);
      if(!raw) return defaultData();
      const d = JSON.parse(raw);
      const def = defaultData();
      if(!d.settings) d.settings = def.settings;
      else d.settings = Object.assign({}, def.settings, d.settings);
      if(!d.days) d.days = {};
      if(!d.running) d.running = { active:false, startTs:null, date:null };
      if(!d.meta) d.meta = { updatedAt: Date.now() };
      return d;
    }catch(e){ return defaultData(); }
  }
  function save(){
    data.meta = data.meta || {};
    data.meta.updatedAt = Date.now();
    localStorage.setItem(STORE_KEY, JSON.stringify(data));
    scheduleCloudPush();
  }

  function fmtDate(d){
    const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }
  function monthKey(dateStr){ return dateStr.slice(0,7); }
  function isWeekend(dateStr){
    const dow = new Date(dateStr+'T00:00:00').getDay();
    return dow===0 || dow===6;
  }

  let data = load();
  let tickHandle = null;
  let lastAlertBoundary = 0;

  function processMidnightRollover(){
    if(!data.running.active) return;
    const todayStr = fmtDate(new Date());
    if(data.running.date === todayStr) return;

    const oldDate = data.running.date;
    const oldDateObj = new Date(oldDate+'T00:00:00');
    const nextMidnight = new Date(oldDateObj.getTime() + 24*3600*1000);
    const elapsedToMidnight = Math.max(0, Math.floor((nextMidnight.getTime() - data.running.startTs)/1000));
    const priorTotal = secondsForDay(oldDate);
    const rawTotal = priorTotal + elapsedToMidnight;
    const roundedMinutes = Math.ceil(rawTotal/60/15)*15;
    data.days[oldDate] = roundedMinutes*60;

    const nextDateStr = fmtDate(nextMidnight);
    if(nextDateStr === todayStr){
      data.running = { active:true, startTs: nextMidnight.getTime(), date: nextDateStr };
    } else {
      data.running = { active:false, startTs:null, date:null };
    }
    lastAlertBoundary = 0;
    save();
  }

  function secondsForDay(dateStr){ return data.days[dateStr] || 0; }

  function liveSecondsToday(){
    const todayStr = fmtDate(new Date());
    let base = secondsForDay(todayStr);
    if(data.running.active && data.running.date === todayStr){
      base += Math.floor((Date.now() - data.running.startTs)/1000);
    }
    return base;
  }

  function monthWorkedHours(ym){
    let secs = 0;
    for(const [dateStr, s] of Object.entries(data.days)){
      if(monthKey(dateStr) === ym) secs += s;
    }
    if(data.running.active && monthKey(data.running.date) === ym){
      secs += Math.floor((Date.now() - data.running.startTs)/1000);
    }
    return secs/3600;
  }

  function listMonthsSince(startDate, endDate){
    const months = [];
    let y = startDate.getFullYear(), m = startDate.getMonth();
    const endY = endDate.getFullYear(), endM = endDate.getMonth();
    while(y < endY || (y===endY && m<=endM)){
      months.push(`${y}-${String(m+1).padStart(2,'0')}`);
      m++; if(m>11){m=0;y++;}
    }
    return months;
  }

  function computeDeltas(){
    const goal = parseFloat(data.settings.monthlyGoalHours) || 0;
    const now = new Date();
    const curYM = fmtDate(now).slice(0,7);
    const monthlyDeltaHrs = monthWorkedHours(curYM) - goal;

    let startD;
    try{ startD = new Date(data.settings.startDate + 'T00:00:00'); }catch(e){ startD = now; }
    if(isNaN(startD.getTime())) startD = now;

    const months = listMonthsSince(startD, now);
    let sumDeltaHrs = 0;
    months.forEach(ym => { sumDeltaHrs += (monthWorkedHours(ym) - goal); });

    return { monthlyDeltaHrs, sumDeltaHrs };
  }

  function computeOverallStats(){
    let totalSecs=0, weekdaySecs=0, weekendSecs=0;
    for(const [dateStr, s] of Object.entries(data.days)){
      totalSecs += s;
      if(isWeekend(dateStr)) weekendSecs += s; else weekdaySecs += s;
    }
    if(data.running.active){
      const liveExtra = Math.floor((Date.now()-data.running.startTs)/1000);
      totalSecs += liveExtra;
      if(isWeekend(data.running.date)) weekendSecs += liveExtra; else weekdaySecs += liveExtra;
    }
    return { totalSecs, weekdaySecs, weekendSecs };
  }

  function fmtHM(totalSeconds){
    const neg = totalSeconds < 0;
    totalSeconds = Math.abs(Math.round(totalSeconds));
    const h = Math.floor(totalSeconds/3600);
    const m = Math.floor((totalSeconds%3600)/60);
    return (neg?'-':'') + String(h).padStart(2,'0') + ':' + String(m).padStart(2,'0');
  }
  function fmtDurationHM(totalSeconds){
    totalSeconds = Math.max(0, Math.floor(totalSeconds));
    const h = Math.floor(totalSeconds/3600);
    const m = Math.floor((totalSeconds%3600)/60);
    return `${h}h ${m}m`;
  }
  function fmtDeltaHrs(hrs){
    const sign = hrs > 0.0001 ? '+' : (hrs < -0.0001 ? '-' : '');
    const totalMinutes = Math.floor(Math.abs(hrs) * 60);
    const hh = Math.floor(totalMinutes/60);
    const mm = totalMinutes%60;
    return `${sign}${hh}h ${mm}m`;
  }
  function deltaClass(hrs){
    if(hrs > 0.0001) return 'pos';
    if(hrs < -0.0001) return 'neg';
    return 'zero';
  }
  function fmtMoneyPlain(amount, currency){
    const sym = CURRENCY_SYMBOLS[currency] || '';
    if(currency === 'HUF'){
      return `${Math.round(amount).toLocaleString()} Ft`;
    }
    return `${sym}${amount.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
  }
  function fmtMoneyDelta(amount, currency){
    const sign = amount < -0.005 ? '-' : (amount > 0.005 ? '+' : '');
    return sign + fmtMoneyPlain(Math.abs(amount), currency);
  }

  const el = {
    dateDisplay: document.getElementById('dateDisplay'),
    dowDisplay: document.getElementById('dowDisplay'),
    clockDisplay: document.getElementById('clockDisplay'),
    clockLabel: document.getElementById('clockLabel'),
    deltaMonthly: document.getElementById('deltaMonthly'),
    deltaSum: document.getElementById('deltaSum'),
    btnStart: document.getElementById('btnStart'),
    btnPause: document.getElementById('btnPause'),
  };

  function renderHeader(){
    const now = new Date();
    el.dateDisplay.textContent = fmtDate(now).replace(/-/g,'.');
    el.dowDisplay.textContent = WEEKDAYS[now.getDay()];
    const h = now.getHours();
    const greeting = h<12 ? 'Good morning' : (h<18 ? 'Good afternoon' : 'Good evening');
    document.getElementById('greetDisplay').textContent = greeting;
  }

  function renderClock(){
    const secs = liveSecondsToday();
    el.clockDisplay.textContent = fmtHM(secs);
    el.clockLabel.textContent = data.running.active ? "Running — today's total" : "Today's total";
  }

  function renderDeltas(){
    const { monthlyDeltaHrs, sumDeltaHrs } = computeDeltas();
    el.deltaMonthly.textContent = fmtDeltaHrs(monthlyDeltaHrs);
    el.deltaSum.textContent = fmtDeltaHrs(sumDeltaHrs);
  }

  function renderButtons(){
    if(data.running.active){
      el.btnStart.classList.add('disabled');
      el.btnPause.classList.remove('disabled');
    } else {
      el.btnStart.classList.remove('disabled');
      el.btnPause.classList.add('disabled');
    }
  }

  function renderAll(){
    processMidnightRollover();
    renderHeader(); renderClock(); renderDeltas(); renderButtons();
  }

  function renderStats(){
    processMidnightRollover();
    const { totalSecs, weekdaySecs, weekendSecs } = computeOverallStats();
    document.getElementById('statTotal').textContent = fmtDurationHM(totalSecs);
    document.getElementById('statWeekday').textContent = fmtDurationHM(weekdaySecs);
    document.getElementById('statWeekend').textContent = fmtDurationHM(weekendSecs);

    const hours = totalSecs/3600;
    const wage = parseFloat(data.settings.hourlyWage) || 0;
    const currency = data.settings.currency || 'EUR';
    const earned = hours*wage;
    const goal = parseFloat(data.settings.financialGoal) || 0;
    const goalDelta = earned - goal;

    document.getElementById('statEarned').textContent = fmtMoneyPlain(earned, currency);
    const gEl = document.getElementById('statGoalDelta');
    gEl.textContent = fmtMoneyDelta(goalDelta, currency);
    gEl.className = 'v mono ' + deltaClass(goalDelta);

    renderEntriesList();
  }

  let expandedMonths = null;

  function secondsForDayDisplay(dateStr){
    let secs = data.days[dateStr] || 0;
    const todayStr = fmtDate(new Date());
    if(data.running.active && data.running.date === todayStr && dateStr === todayStr){
      secs += Math.floor((Date.now()-data.running.startTs)/1000);
    }
    return secs;
  }

  function getMonthDaysList(ym){
    const [y,m] = ym.split('-').map(Number);
    const daysInMonth = new Date(y, m, 0).getDate();
    const todayStr = fmtDate(new Date());
    const isCurrentMonth = (ym === todayStr.slice(0,7));
    const lastDay = isCurrentMonth ? new Date().getDate() : daysInMonth;
    const list = [];
    for(let d=lastDay; d>=1; d--){
      list.push(`${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`);
    }
    return list;
  }

  function getAllMonthsForRegister(){
    const now = new Date();
    let startD;
    try{ startD = new Date(data.settings.startDate+'T00:00:00'); }catch(e){ startD = now; }
    if(isNaN(startD.getTime())) startD = now;
    const months = new Set(listMonthsSince(startD, now));
    Object.keys(data.days).forEach(d=>months.add(monthKey(d)));
    return Array.from(months).sort().reverse();
  }

  function renderEntriesList(){
    const wrap = document.getElementById('entriesList');
    if(!expandedMonths){
      expandedMonths = new Set([fmtDate(new Date()).slice(0,7)]);
    }
    const months = getAllMonthsForRegister();
    if(months.length===0){
      wrap.innerHTML = '<div class="placeholder">No entries yet. Tap "+ Add / edit entry" to add one.</div>';
      return;
    }
    let html = '';
    months.forEach(ym=>{
      const days = getMonthDaysList(ym);
      let monthTotal = 0;
      days.forEach(d=>monthTotal += secondsForDayDisplay(d));
      const isOpen = expandedMonths.has(ym);
      const [y,m] = ym.split('-');
      const monthLabel = new Date(Number(y), Number(m)-1, 1).toLocaleString('en-US',{month:'long', year:'numeric'});
      html += `<div class="month-block">
        <div class="month-header" data-month="${ym}">
          <div class="month-name">${monthLabel}</div>
          <div class="month-meta"><span class="month-total mono">${fmtDurationHM(monthTotal)}</span><span class="month-chevron">${isOpen?'\u25BE':'\u25B8'}</span></div>
        </div>
        <div class="month-days${isOpen?'':' collapsed'}">`;
      days.forEach(d=>{
        const secs = secondsForDayDisplay(d);
        const dow = WEEKDAYS[new Date(d+'T00:00:00').getDay()].slice(0,3);
        const isToday = d === fmtDate(new Date());
        const liveTag = (isToday && data.running.active) ? ' <span class="live-dot"></span>' : '';
        html += `<div class="entry-row" data-date="${d}">
          <div><span class="entry-date">${d}</span><span class="entry-dow">${dow}</span>${liveTag}</div>
          <div class="entry-time mono${secs===0?' zero-entry':''}">${fmtDurationHM(secs)}</div>
        </div>`;
      });
      html += `</div></div>`;
    });
    wrap.innerHTML = html;
    wrap.querySelectorAll('.month-header').forEach(h=>{
      h.addEventListener('click', ()=>{
        const ym = h.dataset.month;
        if(expandedMonths.has(ym)) expandedMonths.delete(ym); else expandedMonths.add(ym);
        renderEntriesList();
      });
    });
    wrap.querySelectorAll('.entry-row').forEach(row=>{
      row.addEventListener('click', (e)=>{ e.stopPropagation(); openEntryModal(row.dataset.date); });
    });
  }

  function startTicking(){
    if(tickHandle) clearInterval(tickHandle);
    tickHandle = setInterval(()=>{
      processMidnightRollover();
      renderClock(); renderDeltas();
      checkReminder();
    }, 1000);
  }

  function ensureNotificationPermission(){
    if('Notification' in window && Notification.permission === 'default'){
      Notification.requestPermission();
    }
  }
  function showToast(msg){
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(()=>toast.classList.remove('show'), 4000);
  }
  function fireReminder(minutes){
    const msg = `Still running — ${minutes} min elapsed. Don't forget to pause.`;
    try{
      if('Notification' in window && Notification.permission === 'granted'){
        new Notification('Work timer running', { body: msg, tag:'work-tracker-reminder' });
      }
    }catch(e){}
    if('vibrate' in navigator){ navigator.vibrate([200,100,200]); }
    showToast(msg);
  }
  function checkReminder(){
    if(!data.running.active) return;
    const elapsedSession = Math.floor((Date.now()-data.running.startTs)/1000);
    const boundary = Math.floor(elapsedSession/900);
    if(boundary>0 && boundary!==lastAlertBoundary){
      lastAlertBoundary = boundary;
      fireReminder(boundary*15);
    }
  }

  function doStart(){
    if(data.running.active) return;
    ensureNotificationPermission();
    const todayStr = fmtDate(new Date());
    data.running = { active:true, startTs: Date.now(), date: todayStr };
    lastAlertBoundary = 0;
    save(); renderAll(); startTicking();
  }

  function doPauseEnd(){
    if(!data.running.active) return;
    const dateStr = data.running.date;
    const elapsedSecs = Math.floor((Date.now() - data.running.startTs)/1000);
    const priorTotal = secondsForDay(dateStr);
    const rawTotal = priorTotal + elapsedSecs;
    const rawMinutes = rawTotal/60;
    const roundedMinutes = Math.ceil(rawMinutes/15)*15;
    data.days[dateStr] = roundedMinutes*60;
    data.running = { active:false, startTs:null, date:null };
    save();
    if(tickHandle){ clearInterval(tickHandle); tickHandle=null; }
    renderAll();
  }

  el.btnStart.addEventListener('click', doStart);
  el.btnPause.addEventListener('click', doPauseEnd);

  const navItems = document.querySelectorAll('.nav div');
  const pages = { home:'page-home', stats:'page-stats', report:'page-report', options:'page-options' };
  navItems.forEach(item=>{
    item.addEventListener('click', ()=>{
      navItems.forEach(i=>i.classList.remove('active'));
      item.classList.add('active');
      Object.values(pages).forEach(pid=>document.getElementById(pid).classList.remove('active'));
      document.getElementById(pages[item.dataset.page]).classList.add('active');
      if(item.dataset.page === 'options') loadOptionsForm();
      if(item.dataset.page === 'stats') renderStats();
    });
  });

  const optGoal = document.getElementById('optGoal');
  const optStart = document.getElementById('optStart');
  const optWage = document.getElementById('optWage');
  const optCurrency = document.getElementById('optCurrency');
  const optFinGoal = document.getElementById('optFinGoal');
  const saveMsg = document.getElementById('saveMsg');

  function loadOptionsForm(){
    optGoal.value = data.settings.monthlyGoalHours;
    optStart.value = data.settings.startDate;
    optWage.value = data.settings.hourlyWage;
    optCurrency.value = data.settings.currency;
    optFinGoal.value = data.settings.financialGoal;
    renderCloudUI();
  }
  function flashSaved(){
    saveMsg.textContent = 'Saved';
    setTimeout(()=>{ saveMsg.textContent=''; }, 1200);
  }
  optGoal.addEventListener('change', ()=>{
    const v = parseFloat(optGoal.value);
    data.settings.monthlyGoalHours = isNaN(v) ? 0 : v;
    save(); renderDeltas(); flashSaved();
  });
  optStart.addEventListener('change', ()=>{
    if(optStart.value){ data.settings.startDate = optStart.value; save(); renderDeltas(); flashSaved(); }
  });
  optWage.addEventListener('change', ()=>{
    const v = parseFloat(optWage.value);
    data.settings.hourlyWage = isNaN(v) ? 0 : v;
    save(); flashSaved();
  });
  optCurrency.addEventListener('change', ()=>{
    data.settings.currency = optCurrency.value;
    save(); flashSaved();
  });
  optFinGoal.addEventListener('change', ()=>{
    const v = parseFloat(optFinGoal.value);
    data.settings.financialGoal = isNaN(v) ? 0 : v;
    save(); flashSaved();
  });
  document.getElementById('btnResetSum').addEventListener('click', ()=>{
    data.settings.startDate = fmtDate(new Date());
    save(); loadOptionsForm(); renderDeltas(); flashSaved();
  });
  document.getElementById('btnResetAll').addEventListener('click', ()=>{
    if(confirm('This deletes all tracked days permanently. Continue?')){
      data.days = {};
      data.running = { active:false, startTs:null, date:null };
      save();
      if(tickHandle){ clearInterval(tickHandle); tickHandle=null; }
      renderAll(); flashSaved();
    }
  });
  document.getElementById('btnExportBackup').addEventListener('click', ()=>{
    try{
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `hours-backup-${fmtDate(new Date())}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('Backup downloaded.');
    }catch(e){
      showToast('Could not create the backup file.');
    }
  });

  let modalMode = 'add';
  let modalEditingDate = null;
  const modalOverlay = document.getElementById('entryModal');
  const modalDate = document.getElementById('modalDate');
  const modalHours = document.getElementById('modalHours');
  const modalMinutes = document.getElementById('modalMinutes');
  const modalDelete = document.getElementById('modalDelete');
  const modalTitle = document.getElementById('modalTitle');

  function openEntryModal(existingDate){
    if(existingDate){
      modalMode = 'edit'; modalEditingDate = existingDate;
      modalDate.value = existingDate; modalDate.disabled = true;
      const secs = data.days[existingDate] || 0;
      modalHours.value = Math.floor(secs/3600);
      modalMinutes.value = Math.floor((secs%3600)/60);
      modalDelete.style.display = 'block';
      modalTitle.textContent = 'Edit entry';
    } else {
      modalMode = 'add'; modalEditingDate = null;
      modalDate.disabled = false;
      modalDate.value = fmtDate(new Date());
      const existing = data.days[modalDate.value];
      modalHours.value = existing ? Math.floor(existing/3600) : 0;
      modalMinutes.value = existing ? Math.floor((existing%3600)/60) : 0;
      modalDelete.style.display = 'none';
      modalTitle.textContent = 'Add / edit entry';
    }
    modalOverlay.classList.add('show');
  }
  function closeModal(){ modalOverlay.classList.remove('show'); }

  modalDate.addEventListener('change', ()=>{
    if(modalMode !== 'add') return;
    const existing = data.days[modalDate.value];
    modalHours.value = existing ? Math.floor(existing/3600) : 0;
    modalMinutes.value = existing ? Math.floor((existing%3600)/60) : 0;
  });

  document.getElementById('modalSave').addEventListener('click', ()=>{
    const dateVal = modalDate.value;
    if(!dateVal) return;
    const h = parseInt(modalHours.value) || 0;
    const m = parseInt(modalMinutes.value) || 0;
    const secs = h*3600 + m*60;
    if(secs <= 0){ delete data.days[dateVal]; } else { data.days[dateVal] = secs; }
    save(); closeModal(); renderStats(); renderDeltas();
  });
  document.getElementById('modalCancel').addEventListener('click', closeModal);
  document.getElementById('modalDelete').addEventListener('click', ()=>{
    if(modalEditingDate && confirm('Delete this entry?')){
      delete data.days[modalEditingDate];
      save(); closeModal(); renderStats(); renderDeltas();
    }
  });
  document.getElementById('btnAddEntry').addEventListener('click', ()=>openEntryModal(null));

  // ---------- cloud sync (Supabase) ----------
  const CLOUD_CFG_KEY = 'workTrackerCloudConfig';
  const TABLE_NAME = 'app_state';
  let supabaseClient = null;
  let supabaseLibLoading = false;
  let cloudSession = null;
  let pushTimer = null;

  function getCloudConfig(){
    try{ return JSON.parse(localStorage.getItem(CLOUD_CFG_KEY)) || {}; }catch(e){ return {}; }
  }
  function setCloudConfig(cfg){ localStorage.setItem(CLOUD_CFG_KEY, JSON.stringify(cfg)); }
  function clearCloudConfig(){ localStorage.removeItem(CLOUD_CFG_KEY); }

  function loadSupabaseLib(cb){
    if(window.supabase){ cb(); return; }
    if(supabaseLibLoading){ setTimeout(()=>loadSupabaseLib(cb), 300); return; }
    supabaseLibLoading = true;
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.108.2';
    s.onload = ()=>{ supabaseLibLoading = false; cb(); };
    s.onerror = ()=>{ supabaseLibLoading = false; showToast('Could not reach the cloud library — check your internet connection.'); };
    document.head.appendChild(s);
  }

  function initCloud(){
    const cfg = getCloudConfig();
    if(!cfg.url || !cfg.key){ renderCloudUI(); return; }
    loadSupabaseLib(()=>{
      try{
        supabaseClient = window.supabase.createClient(cfg.url, cfg.key);
        supabaseClient.auth.getSession().then(({data:sessData})=>{
          cloudSession = sessData.session || null;
          renderCloudUI();
          if(cloudSession) syncNow(true);
        });
      }catch(e){ showToast('Cloud project URL/key look invalid.'); }
    });
  }

  function renderCloudUI(){
    const setupBlock = document.getElementById('cloudSetupBlock');
    const authBlock = document.getElementById('cloudAuthBlock');
    const signedInBlock = document.getElementById('cloudSignedInBlock');
    if(!setupBlock) return;
    const cfg = getCloudConfig();
    if(!cfg.url || !cfg.key){
      setupBlock.style.display = 'block';
      authBlock.style.display = 'none';
      signedInBlock.style.display = 'none';
      return;
    }
    if(!cloudSession){
      setupBlock.style.display = 'none';
      authBlock.style.display = 'block';
      signedInBlock.style.display = 'none';
      document.getElementById('cloudAuthNote').textContent = 'First time: use "Sign up". On another device, connect the same project above and "Log in" with the same email/password.';
    } else {
      setupBlock.style.display = 'none';
      authBlock.style.display = 'none';
      signedInBlock.style.display = 'block';
      document.getElementById('cloudStatus').textContent = `Signed in as ${cloudSession.user.email}.`;
    }
  }

  function scheduleCloudPush(){
    if(!supabaseClient || !cloudSession) return;
    if(pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(()=>pushToCloud(), 1500);
  }

  async function pushToCloud(){
    if(!supabaseClient || !cloudSession) return;
    try{
      await supabaseClient.from(TABLE_NAME).upsert({
        user_id: cloudSession.user.id,
        payload: data,
        updated_at: new Date(data.meta.updatedAt).toISOString()
      });
      const statusEl = document.getElementById('cloudStatus');
      if(statusEl) statusEl.textContent = `Signed in as ${cloudSession.user.email}. Last synced ${new Date().toLocaleTimeString()}.`;
    }catch(e){ /* best-effort; likely offline */ }
  }

  async function syncNow(silent){
    if(!supabaseClient || !cloudSession) return;
    try{
      const { data: rows, error } = await supabaseClient
        .from(TABLE_NAME).select('*').eq('user_id', cloudSession.user.id).maybeSingle();
      if(error) throw error;
      if(rows && rows.payload){
        const remoteUpdated = new Date(rows.updated_at).getTime();
        const localUpdated = (data.meta && data.meta.updatedAt) || 0;
        if(remoteUpdated > localUpdated + 2000){
          data = rows.payload;
          if(!data.meta) data.meta = { updatedAt: remoteUpdated };
          localStorage.setItem(STORE_KEY, JSON.stringify(data));
          renderAll();
          if(document.getElementById('page-stats').classList.contains('active')) renderStats();
          if(!silent) showToast('Pulled newer data from the cloud.');
        } else {
          await pushToCloud();
          if(!silent) showToast('Pushed local data to the cloud.');
        }
      } else {
        await pushToCloud();
        if(!silent) showToast('Uploaded your data to the cloud.');
      }
    }catch(e){
      if(!silent) showToast('Sync failed — check your internet connection.');
    }
  }

  async function pullFromCloudForce(){
    if(!supabaseClient || !cloudSession) return;
    try{
      const { data: rows, error } = await supabaseClient
        .from(TABLE_NAME).select('*').eq('user_id', cloudSession.user.id).maybeSingle();
      if(error) throw error;
      if(rows && rows.payload){
        const hasLocalData = Object.keys(data.days).length > 0;
        if(hasLocalData){
          const ok = confirm('This device already has tracked time saved locally. Logging in will replace it with the data from your cloud account. Continue?');
          if(!ok) return;
        }
        const remoteUpdated = new Date(rows.updated_at).getTime();
        data = rows.payload;
        if(!data.meta) data.meta = { updatedAt: remoteUpdated };
        localStorage.setItem(STORE_KEY, JSON.stringify(data));
        renderAll();
        if(document.getElementById('page-stats').classList.contains('active')) renderStats();
        showToast('Loaded your data from the cloud.');
      } else {
        await pushToCloud();
        showToast('No cloud data yet for this account - uploaded what is on this device.');
      }
    }catch(e){
      showToast('Could not reach the cloud - check your internet connection.');
    }
  }

  document.getElementById('btnCloudConnect').addEventListener('click', ()=>{
    const url = document.getElementById('cloudUrl').value.trim();
    const key = document.getElementById('cloudKey').value.trim();
    if(!url || !key){ showToast('Enter both the project URL and anon key.'); return; }
    setCloudConfig({ url, key });
    initCloud();
  });
  document.getElementById('btnCloudForget').addEventListener('click', ()=>{
    if(supabaseClient) { try{ supabaseClient.auth.signOut(); }catch(e){} }
    clearCloudConfig();
    supabaseClient = null; cloudSession = null;
    renderCloudUI();
  });
  document.getElementById('btnCloudSignup').addEventListener('click', async ()=>{
    const email = document.getElementById('cloudEmail').value.trim();
    const pw = document.getElementById('cloudPassword').value;
    if(!email || !pw){ showToast('Enter an email and password.'); return; }
    try{
      const { data: res, error } = await supabaseClient.auth.signUp({ email, password: pw });
      if(error) throw error;
      if(res.session){ cloudSession = res.session; renderCloudUI(); pushToCloud(); showToast('Account created — this device is now the cloud copy.'); }
      else { document.getElementById('cloudAuthNote').textContent = 'Check your email to confirm the account, then come back and log in.'; }
    }catch(e){ showToast(e.message || 'Sign up failed.'); }
  });
  document.getElementById('btnCloudLogin').addEventListener('click', async ()=>{
    const email = document.getElementById('cloudEmail').value.trim();
    const pw = document.getElementById('cloudPassword').value;
    if(!email || !pw){ showToast('Enter an email and password.'); return; }
    try{
      const { data: res, error } = await supabaseClient.auth.signInWithPassword({ email, password: pw });
      if(error) throw error;
      cloudSession = res.session; renderCloudUI();
      await pullFromCloudForce();
    }catch(e){ showToast(e.message || 'Log in failed.'); }
  });
  document.getElementById('btnCloudSyncNow').addEventListener('click', ()=>syncNow(false));
  document.getElementById('btnCloudSignOut').addEventListener('click', async ()=>{
    if(supabaseClient){ try{ await supabaseClient.auth.signOut(); }catch(e){} }
    cloudSession = null; renderCloudUI();
  });

  // ---------- init ----------
  renderAll();
  if(data.running.active){
    lastAlertBoundary = Math.floor((Date.now()-data.running.startTs)/1000/900);
    startTicking();
  }
  initCloud();

  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('sw.js').catch(()=>{});
    });
  }
})();
