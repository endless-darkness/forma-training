import { EXERCISES, TEMPLATES } from './data.js';
import { recommend, weeklyVolume, trainingStats, sessionAdvice, isValidSet } from './engine.js';
import { STORAGE_KEY, loadState, saveState, parseImport, serializeState } from './storage.js';

const loaded = loadState();
let state = loaded.state;
let storageError = loaded.error;
let otherTabChanged = false;
let route = location.hash.slice(1) || 'overview';
let pendingImport = null;
let waitingWorker = null;
let timerEnd = 0;
let timerAnnounced = false;
let pendingSetRemoval = null;
let toastTimeout;
const main = document.querySelector('#main');
const dialog = document.querySelector('#dialog');
const factor = 2.2046226218;
const icons = {
  overview:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  train:'<path d="M6 8v8M3 10v4m15-6v8m3-6v4M6 12h12"/><path d="M6 8h2v8H6m12-8h-2v8h2"/>',
  progress:'<path d="M4 19V5m0 14h16M8 14l4-4 4 2 5-7"/>',
  history:'<path d="M4 5v5h5M4.6 9a8 8 0 1 1-.2 6M12 7v5l3 2"/>',
  arrow:'<path d="M4 12h16m-6-6 6 6-6 6"/>',
  up:'<path d="m6 14 6-6 6 6M12 8v12"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  sparkle:'<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  calendar:'<rect x="4" y="5" width="16" height="16" rx="2"/><path d="M8 3v4m8-4v4M4 11h16m-12 4h2m4 0h2"/>',
  layers:'<path d="m12 3 10 6-10 6L2 9l10-6Zm-9 11 9 5 9-5m-18 5 9 5 9-5"/>',
  leaf:'<path d="M5 19C-1 6 12 3 21 3c0 10-3 18-13 16m-4 3L16 9"/>',
  chevron:'<path d="m9 5 7 7-7 7"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  shield:'<path d="M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3Z"/><path d="m8 12 3 3 5-6"/>',
};
function icon(name, size=19) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.train}</svg>`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char])); }
function uid() { return crypto.randomUUID(); }
function localDay(date=new Date()) { return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function displayWeight(kg) { return kg == null ? '' : Number((kg * (state.settings.unit === 'lb' ? factor : 1)).toFixed(1)); }
function kgFrom(value) { return value / (state.settings.unit === 'lb' ? factor : 1); }
function fmt(value) { return new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(value); }
function timeText(seconds) { const n = Math.max(0,Math.ceil(seconds)); return `${Math.floor(n/60)}:${String(n%60).padStart(2,'0')}`; }
function todayCheckIn() { return state.checkins[localDay()] || null; }
function workingSets(session) { return session.exercises.flatMap(e=>e.sets).filter(s=>s.done && !s.warmup && isValidSet(s)); }
function nextTemplate() {
  const last = [...state.history].sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt))[0];
  const index = TEMPLATES.findIndex(t=>t.id===last?.templateId);
  return TEMPLATES[(index+1)%TEMPLATES.length];
}
function toast(message) {
  const node = document.querySelector('#toast');
  node.textContent = message; node.classList.add('visible');
  clearTimeout(toastTimeout); toastTimeout=setTimeout(()=>node.classList.remove('visible'),4000);
}
function persist() {
  if(otherTabChanged) { toast('This app changed in another tab. Reload before editing.'); return false; }
  const result = saveState(state);
  storageError = result.error;
  renderNotice();
  return result.ok;
}
function writable() {
  if(otherTabChanged) { toast('Reload to use the latest changes from your other tab.'); return false; }
  if(loaded.error) { toast('Restore a backup in Settings before making changes. Your original data is preserved.'); return false; }
  return true;
}
function renderNotice() {
  const target = document.querySelector('#notice');
  if(otherTabChanged) target.innerHTML='<div class="notice">Your training changed in another tab. Reload to use the latest saved version. <button class="text-button" data-action="reload">Reload app →</button></div>';
  else if(storageError) target.innerHTML=`<div class="notice">${esc(storageError)} <button class="text-button" data-action="settings">Open backups →</button></div>`;
  else if(waitingWorker) target.innerHTML='<div class="notice">A new version of Forma is ready. Your saved workouts will stay here. <button class="text-button" data-action="update">Save & update →</button></div>';
  else target.innerHTML='';
}
function navigate(target) {
  if(location.hash === `#${target}`) { route=target; render(); }
  else location.hash = target;
}
function render() {
  if(!['overview','train','progress','history'].includes(route)) route='overview';
  document.querySelector('#navigation').innerHTML=[['overview','Overview'],['train','My training'],['progress','Progress'],['history','History']].map(([id,label])=>`<a class="nav-link ${route===id?'active':''}" href="#${id}" ${route===id?'aria-current="page"':''}>${icon(id)}<span>${label}</span>${route===id?'<span class="nav-dot"></span>':''}</a>`).join('');
  document.querySelector('#today-date').textContent=new Date().toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
  renderNotice();
  main.innerHTML = route==='train' ? trainingView() : route==='progress' ? progressView() : route==='history' ? historyView() : overviewView();
  document.title=`Forma — ${route==='train' && state.draft ? state.draft.name : ({overview:'Build with intention',train:'My training',progress:'Your progress',history:'Workout history'}[route])}`;
  renderTimer();
}
function statsView() {
  const stats=trainingStats(state.history);
  return `<div class="stats-grid">${[
    ['Sessions',stats.sessions,'',`of ${state.settings.weeklyGoal} weekly goal`,'calendar'],
    ['Working sets',stats.sets,'','Quality reps, added up','layers'],
    ['Volume',fmt(displayWeight(stats.volumeKg)),state.settings.unit,'Recorded weight × reps','train'],
    ['Time training',stats.minutes,'min','In the last 7 days','clock'],
  ].map(([label,value,unit,note,symbol])=>`<div class="card stat"><div class="stat-top"><span>${label}</span>${icon(symbol,16)}</div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-note">${note}</div></div>`).join('')}</div>`;
}
function volumeView() {
  const counts=weeklyVolume(state.history);
  const groups=[['Chest',['Chest']],['Back',['Back']],['Legs',['Quads','Hamstrings','Glutes']],['Shoulders',['Shoulders']],['Arms',['Biceps','Triceps']],['Calves',['Calves']]];
  const data=groups.map(([label,muscles])=>({label,count:muscles.reduce((n,m)=>n+(counts[m]||0),0)}));
  const max=Math.max(12,...data.map(d=>d.count));
  return `<section class="card volume-card" aria-label="Working sets by muscle group"><div class="card-top"><h2>A balanced picture.</h2><span class="chip">Last 7 days</span></div><p class="card-description">Your working sets, by muscle group.</p><div class="bar-chart">${data.map(d=>`<div class="bar-column"><span class="bar-value">${d.count}</span><div class="bar-track"><div class="bar-fill" style="height:${d.count/max*100}%"></div></div><span class="bar-label">${d.label}</span></div>`).join('')}</div><p class="chart-footnote">Primary muscles only · Warm-up sets are excluded.</p></section>`;
}
function overviewView() {
  const stats=trainingStats(state.history), template=nextTemplate(), advice=sessionAdvice(todayCheckIn());
  const progress=Math.min(1,stats.sessions/state.settings.weeklyGoal);
  const focusMuscles=[...new Set(template.exerciseIds.map(id=>EXERCISES.find(e=>e.id===id).muscle))].slice(0,3);
  return `<div class="page-heading"><div><h1>Build with intention.</h1><p>A little more progress. A little less guesswork.</p></div><span class="chip green">${icon('leaf',13)} Your next chapter starts here</span></div>
  <div class="hero-grid"><section class="hero"><div><div class="eyebrow">${icon('sparkle',13)} THE LONG GAME</div><h2>Small gains.<br><em>Stronger you.</em></h2><p>Show up, track the work, and let your progress lead the way.</p><button class="button lime" data-action="${state.draft?'resume':'start'}" data-id="${template.id}">${state.draft?'Resume workout':'Start your next session'} ${icon('arrow',15)}</button></div><div class="goal-ring" role="img" aria-label="${stats.sessions} of ${state.settings.weeklyGoal} sessions in the last seven days"><svg viewBox="0 0 160 160"><circle cx="80" cy="80" r="67" fill="none" stroke="#365042" stroke-width="7"/><circle cx="80" cy="80" r="67" fill="none" stroke="#d5f584" stroke-width="7" stroke-linecap="round" stroke-dasharray="${progress*421} 421"/></svg><div class="ring-label"><strong>${stats.sessions}<span> / ${state.settings.weeklyGoal}</span></strong><span>sessions this week</span></div><span class="ring-caption">CONSISTENCY IS THE GOAL</span></div></section>
  <section class="card next-card"><div class="card-top"><span class="eyebrow">UP NEXT</span>${icon('train',19)}</div><div><h3>${esc(state.draft?.name || template.name)}</h3><p>${state.draft?'Pick up where you left off.':esc(template.subtitle)}</p></div><div class="session-meta"><span>${icon('clock',13)} ~${template.duration} min</span><span>${icon('layers',13)} ${template.exerciseIds.length} exercises</span></div><div class="muscle-chips">${focusMuscles.map(m=>`<span class="chip">${m}</span>`).join('')}</div><button class="text-button" data-action="program">View your program ${icon('arrow',14)}</button></section></div>
  ${statsView()}<div class="insights-grid">${volumeView()}<section class="card coach-card"><div class="coach-heading"><span class="sparkle">${icon('sparkle',17)}</span> YOUR ADAPTIVE COACH <span class="chip green">Rules-based</span></div><h3>${esc(advice.title)}</h3><p>${esc(advice.detail)}</p><button class="text-button" data-action="checkin">${todayCheckIn()?'Update today’s check-in':'A 10-second check-in'} ${icon('arrow',15)}</button></section></div>
  <div class="section-heading"><h2>Your recent work</h2><a class="text-button" href="#history">View history ${icon('arrow',13)}</a></div>${state.history.length?historyRows([...state.history].sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt)).slice(0,2)):emptyRecent()}`;
}
function emptyRecent() { return `<div class="recent-empty"><span class="empty-icon">${icon('train',22)}</span><div><h3>Your first session is a fresh start.</h3><p>Log a workout to start connecting the dots.</p></div><a class="button secondary" href="#train">Let’s get started ${icon('arrow',14)}</a></div>`; }
function trainingView() {
  if(state.draft) return workoutView();
  return `<div class="page-heading"><div><h1>Your work. Your rhythm.</h1><p>A flexible upper / lower split. Start with any session.</p></div><button class="button secondary" data-action="blank">${icon('plus',15)} Custom session</button></div><div class="program-grid">${TEMPLATES.map((template,index)=>`<section class="card program-card"><div class="card-top"><span class="program-index">SESSION 0${index+1}</span><span class="chip ${nextTemplate().id===template.id?'green':''}">${nextTemplate().id===template.id?'Up next':template.focus}</span></div><h2>${esc(template.name)}</h2><p>${esc(template.subtitle)} · About ${template.duration} minutes</p><ul class="exercise-preview">${template.exerciseIds.map(id=>{const ex=EXERCISES.find(e=>e.id===id);return `<li>${esc(ex.name)}<span>${ex.targetSets} × ${ex.repMin}–${ex.repMax}</span></li>`;}).join('')}</ul><button class="button primary full" data-action="start" data-id="${template.id}">Start session ${icon('arrow',15)}</button></section>`).join('')}</div><p class="field-help">Templates are a starting point. Add or remove exercises and sets during a session to match your equipment, experience, and available time.</p>`;
}
function workoutView() {
  const session=state.draft, done=workingSets(session);
  return `<div class="workout-top"><div class="page-heading"><div><h1>${esc(session.name)}</h1><p>One focused set at a time. Your session saves as you go.</p></div></div><div class="workout-actions"><button class="text-button" data-action="discard">Discard</button><button class="button secondary" data-action="timer">${icon('clock',15)} Rest</button><button class="button primary" data-action="finish">Finish workout ${icon('check',15)}</button></div></div><div class="workout-summary"><span><strong>${done.length}</strong>working sets</span><span><strong>${session.exercises.length}</strong>exercises</span><span>${esc(state.settings.unit)} · weight units</span></div>
  ${session.exercises.map(ex=>exerciseCard(ex)).join('')}
  <button class="button secondary full" data-action="add-exercise">${icon('plus',16)} Add an exercise</button><div class="workout-notes field"><label for="workout-notes">Session notes</label><textarea id="workout-notes" maxlength="4000" placeholder="How did the session feel? Anything to remember next time?">${esc(session.notes)}</textarea></div><p class="field-help">RIR = reps in reserve: how many more good reps you could have done. Tap a set number to mark it as a warm-up. For dumbbells, record one dumbbell’s weight consistently.</p>`;
}
function exerciseCard(ex) {
  const advice=recommend(ex,state.history);
  return `<section class="card exercise-card" data-exercise="${esc(ex.id)}"><div class="exercise-title"><div><h2>${esc(ex.name)}</h2><div class="exercise-subtitle"><span>${esc(ex.muscle)}</span><span>${ex.targetSets} sets · ${ex.repMin}–${ex.repMax} reps</span><span>~${timeText(ex.restSeconds)} rest</span></div></div><button class="icon-button" data-action="remove-exercise" data-id="${esc(ex.id)}" aria-label="Remove ${esc(ex.name)}">${icon('close',15)}</button></div><div class="advice-line"><div><strong>${esc(advice.title)}</strong><br>${esc(advice.detail)}</div>${advice.increase?`<button class="text-button" data-action="apply-load" data-id="${esc(ex.id)}">Use ${fmt(displayWeight(advice.weightKg))} ${state.settings.unit} ${icon('up',12)}</button>`:''}</div>
  <table class="set-table"><thead><tr><th scope="col">Set</th><th scope="col">${state.settings.unit}</th><th scope="col">Reps</th><th scope="col"><abbr title="Reps in reserve">RIR</abbr></th><th scope="col">Log</th></tr></thead><tbody>${ex.sets.map((set,index)=>`<tr class="${set.done?'done':''}" data-set="${esc(set.id)}"><td><button class="set-type ${set.warmup?'warmup':''}" data-action="warmup" data-ex="${esc(ex.id)}" data-id="${esc(set.id)}" aria-label="Set ${index+1}: ${set.warmup?'warm-up; change to working set':'working set; change to warm-up'}">${set.warmup?'W':index+1}</button></td>${[['weightKg',displayWeight(set.weightKg),state.settings.unit,'0.1',state.settings.unit==='lb'?2204.6:1000],['reps',set.reps,'reps','1',100],['rir',set.rir,'reps in reserve','1',10]].map(([field,value,label,step,max])=>`<td><input type="number" inputmode="${field==='weightKg'?'decimal':'numeric'}" min="${field==='reps'?1:0}" max="${max}" step="${step}" value="${esc(value)}" data-field="${field}" data-ex="${esc(ex.id)}" data-id="${esc(set.id)}" aria-label="${esc(ex.name)} set ${index+1} ${label}"></td>`).join('')}<td><div class="set-actions"><button class="complete-set ${set.done?'checked':''}" data-action="complete-set" data-ex="${esc(ex.id)}" data-id="${esc(set.id)}" aria-label="${set.done?'Unlog':'Log'} ${esc(ex.name)} set ${index+1}" aria-pressed="${set.done}">${icon('check',17)}</button><button class="remove-set" data-action="remove-set" data-ex="${esc(ex.id)}" data-id="${esc(set.id)}" aria-label="Remove set ${index+1}">${icon('close',12)}</button></div></td></tr>`).join('')}</tbody></table><button class="add-set" data-action="add-set" data-id="${esc(ex.id)}">${icon('plus',13)} Add set</button></section>`;
}
function progressView() {
  const seen = new Map();
  for(const session of state.history) for(const ex of session.exercises) {
    const sets=ex.sets.filter(s=>s.done&&!s.warmup&&isValidSet(s));
    if(!sets.length) continue;
    const best=sets.reduce((a,b)=>b.weightKg>a.weightKg||b.weightKg===a.weightKg&&b.reps>a.reps?b:a);
    const previous=seen.get(ex.exerciseId);
    if(!previous || best.weightKg>previous.best.weightKg || best.weightKg===previous.best.weightKg && best.reps>previous.best.reps) seen.set(ex.exerciseId,{ex,best});
  }
  return `<div class="page-heading"><div><h1>Progress you can see.</h1><p>The work adds up. Here’s your last seven days.</p></div><span class="chip green">${state.history.length} lifetime sessions</span></div>${statsView()}${volumeView()}<div class="section-heading"><h2>Your best logged sets</h2><span>All time</span></div>${seen.size?`<div class="progress-list">${[...seen.values()].map(({ex,best})=>{const advice=recommend(ex,state.history);return `<section class="progress-item"><div class="card-top"><h3>${esc(ex.name)}</h3>${advice.increase?'<span class="chip green">Ready to progress</span>':''}</div><div class="best-weight">${fmt(displayWeight(best.weightKg))} <span class="small-label">${state.settings.unit} × ${best.reps} reps</span></div><p>${esc(advice.title)} · ${best.rir} RIR in this set</p></section>`;}).join('')}</div><p class="field-help">Highest recorded working-set weight, then reps at that weight. Training records are useful signals, not a direct measurement of muscle growth.</p>`:`<div class="empty-state"><span class="empty-icon">${icon('progress',24)}</span><h2>Your baseline starts here.</h2><p>Finish your first workout to see your best sets and personalized progression suggestions.</p><a class="button primary" href="#train">Start training ${icon('arrow',15)}</a></div>`}`;
}
function historyView() {
  const sessions=[...state.history].sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt));
  return `<div class="page-heading"><div><h1>Every session counts.</h1><p>Your training journal, one workout at a time.</p></div><button class="button secondary" data-action="export">${icon('download',15)} Export backup</button></div>${sessions.length?historyRows(sessions):`<div class="empty-state"><span class="empty-icon">${icon('history',24)}</span><h2>Good things take reps.</h2><p>Your completed sessions will live here. Start a workout and make the first entry.</p><a class="button primary" href="#train">Find your session ${icon('arrow',15)}</a></div>`}`;
}
function historyRows(sessions) {
  return sessions.map(session=>`<details class="history-item"><summary><span class="empty-icon">${icon('train',21)}</span><span class="history-title"><strong>${esc(session.name)}</strong><span>${new Date(session.startedAt).toLocaleDateString(undefined,{weekday:'short',month:'short',day:'numeric',year:'numeric'})} · ${Math.max(0,Math.round((Date.parse(session.endedAt)-Date.parse(session.startedAt))/60000))} min</span></span><span class="history-stat">${workingSets(session).length} working sets</span>${icon('chevron',14)}</summary><div class="history-detail">${session.exercises.map(ex=>`<h4>${esc(ex.name)}</h4><p>${ex.sets.filter(s=>s.done&&isValidSet(s)).map(s=>`${fmt(displayWeight(s.weightKg))} ${state.settings.unit} × ${s.reps} · ${s.rir} RIR${s.warmup?' (warm-up)':''}`).join(' / ') || 'No sets logged'}</p>`).join('')}${session.notes?`<h4>Notes</h4><p class="history-notes">${esc(session.notes)}</p>`:''}<button class="text-button danger" data-action="delete-workout" data-id="${esc(session.id)}">Delete this workout</button></div></details>`).join('');
}

function showDialog(title, description, content) {
  dialog.innerHTML=`<div class="dialog-header"><h2 id="dialog-title">${esc(title)}</h2><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close',19)}</button></div>${description?`<p class="dialog-description">${esc(description)}</p>`:''}${content}`;
  if(!dialog.open) dialog.showModal();
}
function confirmDialog(title, description, action, id='', label='Confirm', danger=false) {
  showDialog(title,description,`<div class="dialog-actions"><button class="button secondary" data-action="close-dialog">Cancel</button><button class="button ${danger?'danger':'primary'}" data-action="${action}" data-id="${esc(id)}">${label}</button></div>`);
}
function showCheckIn() {
  const current=todayCheckIn()||{energy:'okay',soreness:0,pain:false};
  showDialog('How are you feeling?','A quick check-in gives your training some context. You’re always in control.',`<form id="checkin-form"><div class="field"><span class="field-label" id="energy-label">Energy today</span><div class="segmented" role="group" aria-labelledby="energy-label">${[['low','Low'],['okay','Okay'],['great','Great']].map(([value,label])=>`<label><input type="radio" name="energy" value="${value}" ${current.energy===value?'checked':''}><span>${label}</span></label>`).join('')}</div></div><div class="field"><label for="soreness">Muscle soreness</label><select name="soreness" id="soreness">${['None','Mild','Moderate','High'].map((label,i)=>`<option value="${i}" ${current.soreness===i?'selected':''}>${label}</option>`).join('')}</select></div><label class="checkbox-label"><input name="pain" type="checkbox" ${current.pain?'checked':''}> I’m feeling pain beyond normal muscle soreness</label><div class="dialog-actions"><button class="button primary full" type="submit">Save today’s check-in ${icon('check',15)}</button></div></form>`);
}
function showSettings() {
  showDialog('Your preferences','Make Forma fit the way you train.',`<form id="settings-form"><div class="field-row"><div class="field"><label for="weight-unit">Weight unit</label><select name="unit" id="weight-unit"><option value="lb" ${state.settings.unit==='lb'?'selected':''}>Pounds (lb)</option><option value="kg" ${state.settings.unit==='kg'?'selected':''}>Kilograms (kg)</option></select></div><div class="field"><label for="weekly-goal">Weekly session goal</label><input name="weeklyGoal" id="weekly-goal" type="number" min="1" max="7" step="1" required value="${state.settings.weeklyGoal}"></div></div><div class="field"><label for="rest-seconds">Manual rest timer (seconds)</label><input name="restSeconds" id="rest-seconds" type="number" min="0" max="600" step="15" required value="${state.settings.restSeconds}"><small>Logging a set uses that exercise’s suggested rest. This controls the manual timer.</small></div><button class="button primary full" type="submit">Save preferences</button></form><div class="settings-section"><h3>Your data stays yours.</h3><p>Workouts are saved in this browser on this device. There’s no account or cloud sync. Clearing browser data removes them, so keep a backup.</p><div class="backup-buttons"><button class="button secondary" data-action="export">${icon('download',15)} Export backup</button><button class="button secondary" data-action="import">Restore backup</button></div>${loaded.error?'<p class="field-help">Existing unreadable data has been preserved. Export original data before restoring a backup.</p><button class="text-button" data-action="export-original">Export original saved data</button>':''}</div><div class="settings-section"><h3>Take Forma with you.</h3><p>On iPhone: open this site in Safari, tap Share, then Add to Home Screen. Open once online to prepare offline access.</p></div>`);
}
function showAbout() {
  showDialog('Training, thoughtfully adjusted.','Forma is a private training journal with an explainable progression engine.',`<ul class="dialog-list"><li>Log weight, reps, and reps in reserve (RIR) for every working set.</li><li>A small load increase is suggested after two complete sessions hit the top of the rep range at the same load, with at least one rep in reserve.</li><li>Check-ins add context. Suggestions never change your weights automatically.</li><li>The current coach uses transparent rules, not a trained AI model. No API keys, accounts, or paid AI service are needed.</li><li>There is no Apple Health connection or health-data upload. All workout records stay in this browser.</li></ul><div class="muted-block">Better training decisions are the aim. Logs and check-ins cannot measure muscle growth or guarantee the fastest possible results.</div><p class="field-help">Programming context: <a class="about-link" href="https://pubmed.ncbi.nlm.nih.gov/38393985/" target="_blank" rel="noopener noreferrer">2024 study of training with reps in reserve</a>. Forma’s exact progression rules are product choices, not a validated predictive model.</p>`);
}
function newExercise(ex) {
  // A proposed increase is never applied without the user's choice.
  const latest=[...state.history].sort((a,b)=>Date.parse(b.endedAt)-Date.parse(a.endedAt)).flatMap(s=>s.exercises).find(e=>e.exerciseId===ex.id&&e.sets.some(s=>s.done&&!s.warmup&&isValidSet(s)));
  const load=latest ? Math.min(...latest.sets.filter(s=>s.done&&!s.warmup&&isValidSet(s)).map(s=>s.weightKg)) : 0;
  return { id:uid(),exerciseId:ex.id,name:ex.name,muscle:ex.muscle,repMin:ex.repMin,repMax:ex.repMax,targetSets:ex.targetSets,restSeconds:ex.restSeconds,incrementKg:ex.incrementKg,sets:Array.from({length:ex.targetSets},()=>({id:uid(),weightKg:load,reps:ex.repMin,rir:2,warmup:false,done:false})) };
}
function startSession(template) {
  if(!writable()) return;
  if(state.draft) { navigate('train'); toast('Resuming your active workout.'); return; }
  state.draft={id:uid(),templateId:template?.id||'custom',name:template?.name||'Custom session',startedAt:new Date().toISOString(),endedAt:null,notes:'',exercises:(template?.exerciseIds||[]).map(id=>newExercise(EXERCISES.find(e=>e.id===id)))};
  persist(); navigate('train');
  if(!template) showAddExercise();
}
function showAddExercise() {
  const options=EXERCISES.filter(ex=>!state.draft?.exercises.some(log=>log.exerciseId===ex.id));
  showDialog('Make it your session.','Add an exercise from the library.',options.length?`<form id="exercise-form"><div class="field"><label for="exercise-choice">Exercise</label><select id="exercise-choice" name="exerciseId">${options.map(ex=>`<option value="${ex.id}">${esc(ex.name)} · ${esc(ex.muscle)}</option>`).join('')}</select></div><button class="button primary full" type="submit">Add exercise ${icon('plus',15)}</button></form>`:'<p class="muted-block">All library exercises are already in this session.</p>');
}
function findSet(exId,setId) { return state.draft?.exercises.find(ex=>ex.id===exId)?.sets.find(set=>set.id===setId); }
function startTimer(seconds) {
  if(!seconds) { stopTimer(); return; }
  timerEnd=Date.now()+seconds*1000; timerAnnounced=false;
  try{sessionStorage.setItem('forma.restEnd',String(timerEnd));}catch{}
  renderTimer();
}
function stopTimer() { timerEnd=0;try{sessionStorage.removeItem('forma.restEnd');}catch{}renderTimer(); }
function renderTimer() {
  const holder=document.querySelector('#timer');
  if(!timerEnd) { holder.innerHTML='';return; }
  const seconds=(timerEnd-Date.now())/1000;
  if(seconds<=0&&!timerAnnounced){timerAnnounced=true;toast('Rest timer finished. Start your next set when you feel ready.');}
  if(holder.firstElementChild) {
    holder.querySelector('.eyebrow').textContent=seconds>0?'TAKE A BREATHER':'WHEN YOU’RE READY';
    const value=holder.querySelector('.timer-value');value.textContent=seconds>0?timeText(seconds):'Rest complete';value.classList.toggle('finished',seconds<=0);
    holder.querySelector('[data-action="skip-timer"]').textContent=seconds>0?'Skip':'Done';
    return;
  }
  holder.innerHTML=`<div class="rest-timer"><div><div class="eyebrow">${seconds>0?'TAKE A BREATHER':'WHEN YOU’RE READY'}</div><span class="timer-value ${seconds<=0?'finished':''}">${seconds>0?timeText(seconds):'Rest complete'}</span></div><span class="timer-separator"></span><button data-action="extend-timer">+30s</button><button data-action="skip-timer">${seconds>0?'Skip':'Done'}</button><button class="icon-button" data-action="skip-timer" aria-label="Close rest timer">${icon('close',16)}</button></div>`;
}
function download(content,name) {
  const blob=new Blob([content],{type:'application/json'}), url=URL.createObjectURL(blob), link=document.createElement('a');
  link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
}

document.addEventListener('click',event=>{
  if(event.target.closest('.skip-link')) {event.preventDefault();main.focus();return;}
  const button=event.target.closest('[data-action]');if(!button) return;
  const {action,id,ex:exId}=button.dataset;
  const readOnlyActions=['settings','about','close-dialog','export','export-original','import','confirm-import','program','resume','reload','update','skip-timer','extend-timer','timer','checkin'];
  if(!readOnlyActions.includes(action)&&!writable()) return;
  const ex=state.draft?.exercises.find(e=>e.id===(exId||id));
  const set=findSet(exId,id);
  switch(action) {
    case 'settings':showSettings();break;
    case 'about':showAbout();break;
    case 'close-dialog':dialog.close();pendingImport=null;break;
    case 'program': case 'resume':navigate('train');break;
    case 'start':startSession(TEMPLATES.find(t=>t.id===id));break;
    case 'blank':startSession(null);break;
    case 'checkin':showCheckIn();break;
    case 'add-exercise':showAddExercise();break;
    case 'add-set':if(ex&&ex.sets.length<100){const last=ex.sets.at(-1);ex.sets.push({id:uid(),weightKg:last?.weightKg??0,reps:last?.reps??ex.repMin,rir:2,warmup:false,done:false});persist();render();}break;
    case 'remove-set':if(set){if(set.done){pendingSetRemoval={exerciseId:exId,setId:id};confirmDialog('Remove this set?','This set has already been logged. Removing it will update your session.','confirm-remove-set','','Remove set',true);}else{ex.sets=ex.sets.filter(s=>s.id!==id);persist();render();}}break;
    case 'confirm-remove-set':{const exercise=state.draft?.exercises.find(e=>e.id===pendingSetRemoval?.exerciseId);if(exercise){exercise.sets=exercise.sets.filter(s=>s.id!==pendingSetRemoval.setId);pendingSetRemoval=null;persist();dialog.close();render();}break;}
    case 'warmup':if(set){set.warmup=!set.warmup;persist();render();}break;
    case 'complete-set':if(set){if(!set.done&&!isValidSet(set)){toast('Enter a valid weight, 1–100 reps, and 0–10 reps in reserve.');return;}set.done=!set.done;persist();if(set.done)startTimer(ex.restSeconds);render();}break;
    case 'apply-load':if(ex){const advice=recommend(ex,state.history);confirmDialog('Try the suggested load?',`Set unfinished working sets to ${fmt(displayWeight(advice.weightKg))} ${state.settings.unit}. Adjust it to match your available equipment and how warm-ups feel.`,'confirm-load',ex.id,'Apply to unfinished sets');}break;
    case 'confirm-load':if(ex){const advice=recommend(ex,state.history);if(advice.increase){ex.sets.forEach(s=>{if(!s.done&&!s.warmup)s.weightKg=advice.weightKg;});persist();dialog.close();render();}}break;
    case 'remove-exercise':if(ex)confirmDialog('Remove this exercise?',`${ex.name} and its sets will be removed from this session.`,'confirm-remove-exercise',id,'Remove exercise',true);break;
    case 'confirm-remove-exercise':if(state.draft){state.draft.exercises=state.draft.exercises.filter(e=>e.id!==id);persist();dialog.close();render();}break;
    case 'discard':confirmDialog('Discard this workout?','Your active session and its sets will be removed. Saved workouts will stay in your history.','confirm-discard','','Discard workout',true);break;
    case 'confirm-discard':{const draft=state.draft;state.draft=null;if(persist()){stopTimer();dialog.close();render();}else state.draft=draft;break;}
    case 'finish':if(!state.draft||!workingSets(state.draft).length){toast('Log at least one working set before finishing.');break;}confirmDialog('One more session in the books.',`${workingSets(state.draft).length} working sets will be saved. Unlogged sets are excluded from your totals.`,'confirm-finish','','Save workout');break;
    case 'confirm-finish':if(state.draft){const draft=state.draft;const completed=structuredClone(draft);completed.endedAt=new Date().toISOString();state.history.unshift(completed);state.draft=null;if(persist()){stopTimer();dialog.close();navigate('history');toast('Workout saved. That’s progress.');}else{state.history.shift();state.draft=draft;}}break;
    case 'delete-workout':confirmDialog('Delete this workout?','This removes the session from your history and updates your progress. Export a backup first if you want to keep a copy.','confirm-delete',id,'Delete workout',true);break;
    case 'confirm-delete':{const history=state.history;state.history=history.filter(s=>s.id!==id);if(persist()){dialog.close();render();toast('Workout deleted.');}else state.history=history;break;}
    case 'timer':startTimer(state.settings.restSeconds);break;
    case 'extend-timer':timerEnd=Math.max(timerEnd,Date.now())+30000;timerAnnounced=false;try{sessionStorage.setItem('forma.restEnd',String(timerEnd));}catch{}renderTimer();break;
    case 'skip-timer':stopTimer();break;
    case 'export':try{download(serializeState(state),`forma-backup-${localDay()}.json`);toast('Backup downloaded. Keep it somewhere private.');}catch(error){toast(error.message);}break;
    case 'export-original':try{const original=localStorage.getItem(STORAGE_KEY);if(original)download(original,`forma-original-${localDay()}.json`);}catch{toast('Browser storage is unavailable.');}break;
    case 'import':document.querySelector('#import-file').click();break;
    case 'confirm-import':if(pendingImport){try{const serialized=serializeState(pendingImport);localStorage.setItem(STORAGE_KEY,serialized);state=pendingImport;pendingImport=null;loaded.error=null;otherTabChanged=false;storageError=null;stopTimer();dialog.close();render();toast('Backup restored.');}catch(error){toast(error.message||'Could not restore this backup. Existing data is preserved.');}}break;
    case 'reload':location.reload();break;
    case 'update':if(waitingWorker&&persist()){waitingWorker.postMessage({type:'SKIP_WAITING'});}break;
  }
});

document.addEventListener('input',event=>{
  const input=event.target;
  if(input.matches('[data-field]')) {
    if(!writable()){render();return;}
    const set=findSet(input.dataset.ex,input.dataset.id);if(!set)return;
    const raw=input.value===''?null:Number(input.value);
    const value=input.dataset.field==='weightKg'&&raw!==null?kgFrom(raw):raw;
    const previous=set[input.dataset.field];set[input.dataset.field]=value;
    if(value!==null && (!Number.isFinite(value)||Math.abs(value)>(input.dataset.field==='weightKg'?1000:input.dataset.field==='reps'?100:10))){set[input.dataset.field]=previous;toast('That number is outside the supported range.');render();return;}
    // Editing a completed set requires logging the changed set again.
    if(set.done){set.done=false;persist();const row=input.closest('tr');row.classList.remove('done');const button=row.querySelector('.complete-set');button.classList.remove('checked');button.setAttribute('aria-pressed','false');button.setAttribute('aria-label',button.getAttribute('aria-label').replace(/^Unlog/,'Log'));toast('Set updated. Tap the checkmark to log it again.');}
    else persist();
  }
});
document.addEventListener('input',event=>{
  if(event.target.id==='workout-notes'&&state.draft&&writable()){state.draft.notes=event.target.value;persist();}
});
document.addEventListener('submit',event=>{
  const form=event.target;if(!['checkin-form','settings-form','exercise-form'].includes(form.id))return;
  event.preventDefault();if(!writable())return;
  const previousState=structuredClone(state);
  const data=new FormData(form);
  if(form.id==='checkin-form'){state.checkins[localDay()]={energy:data.get('energy'),soreness:Number(data.get('soreness')),pain:data.get('pain')==='on'};}
  if(form.id==='settings-form'){state.settings={unit:data.get('unit'),weeklyGoal:Number(data.get('weeklyGoal')),restSeconds:Number(data.get('restSeconds'))};}
  if(form.id==='exercise-form'&&state.draft){const ex=EXERCISES.find(e=>e.id===data.get('exerciseId'));if(ex)state.draft.exercises.push(newExercise(ex));}
  if(persist()){dialog.close();render();toast(form.id==='checkin-form'?'Check-in saved.':form.id==='settings-form'?'Preferences saved.':'Exercise added.');}
  else {state=previousState;toast('Changes could not be saved. Your previous settings and session are unchanged.');}
});
document.querySelector('#import-file').addEventListener('change',async event=>{
  const file=event.target.files[0];event.target.value='';if(!file)return;
  try{if(file.size>5*1024*1024)throw new Error('Choose a backup smaller than 5 MB.');pendingImport=parseImport(await file.text());confirmDialog('Restore this backup?',`This backup contains ${pendingImport.history.length} saved workouts${pendingImport.draft?' and an active session':''}. It will replace this browser’s current data. Export your current backup first if you want to keep both.`,'confirm-import','','Replace with backup');}catch(error){pendingImport=null;toast(error.message);}
});
window.addEventListener('hashchange',()=>{route=location.hash.slice(1)||'overview';render();window.scrollTo({top:0,behavior:'instant'});main.focus({preventScroll:true});});
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY||event.key===null){otherTabChanged=true;renderNotice();}});
window.addEventListener('beforeunload',event=>{if(storageError&&!loaded.error){event.preventDefault();event.returnValue='';}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden){renderTimer();if(!dialog.open && !document.activeElement?.matches('input,textarea,select'))render();}});
dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
try{const saved=Number(sessionStorage.getItem('forma.restEnd'));if(Number.isFinite(saved)&&saved>Date.now()-3600000)timerEnd=saved;}catch{}
setInterval(renderTimer,1000);
render();
if('serviceWorker' in navigator && !['localhost','127.0.0.1'].includes(location.hostname)) {
  navigator.serviceWorker.register('./sw.js').then(registration=>{
    function updateReady(){if(registration.waiting){waitingWorker=registration.waiting;renderNotice();}}
    updateReady();
    registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',()=>{if(registration.installing?.state==='installed')updateReady();}));
  }).catch(()=>{toast('Offline setup is unavailable; workout logging still works while the page is open.');});
  navigator.serviceWorker.addEventListener('controllerchange',()=>{if(waitingWorker)location.reload();});
}
