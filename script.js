/* ==========================================================================
   Pulse — Life Dashboard
   Pure vanilla JS. All data lives in localStorage under LS_KEY.
   No frameworks, no build step, no network requests. Works fully offline.
   ========================================================================== */
(function(){
"use strict";

const LS_KEY = "pulseLifeDashboard.v1";

/* -------------------------------------------------------------------------- */
/* Date helpers                                                                */
/* -------------------------------------------------------------------------- */
function pad(n){ return String(n).padStart(2,"0"); }
function dateStr(d){ return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }
function todayStr(){ return dateStr(new Date()); }
function parseDate(s){ const [y,m,d]=s.split("-").map(Number); return new Date(y, m-1, d); }
function addDays(d, n){ const c=new Date(d); c.setDate(c.getDate()+n); return c; }
function addMonths(d, n){ const c=new Date(d); c.setMonth(c.getMonth()+n); return c; }
function isSameDay(a,b){ return dateStr(a)===dateStr(b); }
const DOW = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const DOW_FULL = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
function friendlyDate(s){
  const d = parseDate(s);
  return `${DOW_FULL[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
}
function shortDate(s){
  const d = parseDate(s);
  return `${MONTHS[d.getMonth()].slice(0,3)} ${d.getDate()}`;
}
function daysAgo(s){
  const d = parseDate(s), t = parseDate(todayStr());
  return Math.round((t - d) / 86400000);
}
function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }

/* -------------------------------------------------------------------------- */
/* State                                                                       */
/* -------------------------------------------------------------------------- */
function defaultData(){
  return {
    settings: { theme: null, waterGoal: 8, sleepGoal: 8, pomodoro: { focus:25, brk:5, long:15, longEvery:4 } },
    habits: [],       // {id,name,emoji,createdAt,completions:{date:true}}
    checklist: {},    // date -> [{id,text,done}]
    mood: {},         // date -> {emoji,label,value}
    water: {},        // date -> count
    sleep: {},        // date -> hours
    pomodoro: { sessions: [] }, // {id,date,minutes,type}
    notes: [],        // {id,title,content,createdAt,updatedAt}
    journal: {},      // date -> {text, updatedAt}
    goals: []         // {id,title,unit,target,current,deadline,createdAt,completedAt}
  };
}

let state = load();

function load(){
  try{
    const raw = localStorage.getItem(LS_KEY);
    if(!raw) return defaultData();
    const parsed = JSON.parse(raw);
    const d = defaultData();
    // shallow-merge to survive schema growth across versions
    return Object.assign(d, parsed, {
      settings: Object.assign(d.settings, parsed.settings || {}, {
        pomodoro: Object.assign(d.settings.pomodoro, (parsed.settings && parsed.settings.pomodoro) || {})
      })
    });
  }catch(e){
    console.error("Failed to load data, starting fresh.", e);
    return defaultData();
  }
}

function save(){
  try{
    localStorage.setItem(LS_KEY, JSON.stringify(state));
  }catch(e){
    console.error("Failed to save data.", e);
    toast("Couldn't save — storage may be full.");
  }
}

/* -------------------------------------------------------------------------- */
/* Toast + Modal                                                              */
/* -------------------------------------------------------------------------- */
let toastTimer = null;
function toast(msg){
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("is-open");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove("is-open"), 2200);
}

const modalBackdrop = () => document.getElementById("modalBackdrop");
function openModal(title, bodyEl){
  document.getElementById("modalTitle").textContent = title;
  const body = document.getElementById("modalBody");
  body.innerHTML = "";
  body.appendChild(bodyEl);
  modalBackdrop().classList.add("is-open");
  const firstInput = body.querySelector("input,textarea,select");
  if(firstInput) setTimeout(()=>firstInput.focus(), 50);
}
function closeModal(){ modalBackdrop().classList.remove("is-open"); }
document.getElementById("modalClose").addEventListener("click", closeModal);
modalBackdrop().addEventListener("click", (e)=>{ if(e.target===modalBackdrop()) closeModal(); });
document.addEventListener("keydown", (e)=>{ if(e.key==="Escape") { closeModal(); closeMoreSheet(); } });

function el(tag, attrs={}, children=[]){
  const node = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs)){
    if(k==="class") node.className = v;
    else if(k==="html") node.innerHTML = v;
    else if(k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else if(v !== null && v !== undefined) node.setAttribute(k, v);
  }
  (Array.isArray(children)?children:[children]).forEach(c=>{
    if(c===null || c===undefined) return;
    node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  });
  return node;
}

/* -------------------------------------------------------------------------- */
/* Theme                                                                       */
/* -------------------------------------------------------------------------- */
function applyTheme(){
  const theme = state.settings.theme || (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  document.documentElement.setAttribute("data-theme", theme);
  document.getElementById("themeLabel").textContent = theme === "dark" ? "Dark mode" : "Light mode";
}
function toggleTheme(){
  const current = document.documentElement.getAttribute("data-theme");
  state.settings.theme = current === "dark" ? "light" : "dark";
  save(); applyTheme();
  renderAll();
}
document.getElementById("themeToggle").addEventListener("click", toggleTheme);
document.getElementById("moreThemeToggle").addEventListener("click", toggleTheme);

/* -------------------------------------------------------------------------- */
/* Navigation                                                                  */
/* -------------------------------------------------------------------------- */
const SECTION_TITLES = {
  dashboard: ["Dashboard", "Your day at a glance"],
  habits: ["Habits", "Build consistency, one check-in at a time"],
  checklist: ["Checklist", "What needs to get done today"],
  calendar: ["Calendar", "Everything you've logged, by day"],
  mood: ["Mood", "Check in with how you're feeling"],
  wellness: ["Wellness", "Water and sleep, tracked daily"],
  pomodoro: ["Pomodoro", "Focused work, timed right"],
  notes: ["Notes", "Quick thoughts and things to remember"],
  journal: ["Journal", "A daily record, in your own words"],
  goals: ["Goals", "Targets worth working toward"],
  stats: ["Statistics", "The full picture of your progress"],
  search: ["Search results", ""]
};

function showSection(name){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("is-active"));
  const view = document.getElementById("view-"+name);
  if(view) view.classList.add("is-active");
  document.querySelectorAll(".nav-item").forEach(b=> b.classList.toggle("is-active", b.dataset.section===name));
  document.querySelectorAll(".mnav-item").forEach(b=> b.classList.toggle("is-active", b.dataset.section===name));
  const [title, sub] = SECTION_TITLES[name] || ["", ""];
  document.getElementById("pageTitle").textContent = title;
  document.getElementById("pageSubtitle").textContent = sub;
  window.scrollTo(0,0);
  renderSection(name);
}

document.getElementById("mainNav").addEventListener("click", (e)=>{
  const btn = e.target.closest(".nav-item");
  if(btn) showSection(btn.dataset.section);
});
document.getElementById("mobileNav").addEventListener("click", (e)=>{
  const btn = e.target.closest(".mnav-item");
  if(!btn) return;
  if(btn.dataset.section === "more") openMoreSheet();
  else showSection(btn.dataset.section);
});
function openMoreSheet(){ document.getElementById("moreSheet").classList.add("is-open"); }
function closeMoreSheet(){ document.getElementById("moreSheet").classList.remove("is-open"); }
document.getElementById("moreClose").addEventListener("click", closeMoreSheet);
document.getElementById("moreSheet").addEventListener("click", (e)=>{
  if(e.target.id === "moreSheet") closeMoreSheet();
  const btn = e.target.closest(".more-item[data-section]");
  if(btn){ showSection(btn.dataset.section); closeMoreSheet(); }
});

function renderSection(name){
  if(name==="dashboard") renderDashboard();
  else if(name==="habits") renderHabits();
  else if(name==="checklist") renderChecklist();
  else if(name==="calendar") renderCalendar();
  else if(name==="mood") renderMood();
  else if(name==="wellness") renderWellness();
  else if(name==="pomodoro") renderPomodoroView();
  else if(name==="notes") renderNotes();
  else if(name==="journal") renderJournal();
  else if(name==="goals") renderGoals();
  else if(name==="stats") renderStats();
}
function renderAll(){ ["dashboard","habits","checklist","calendar","mood","wellness","pomodoro","notes","journal","goals","stats"].forEach(renderSection); }

/* -------------------------------------------------------------------------- */
/* Activity scoring (for heatmap + progress)                                  */
/* -------------------------------------------------------------------------- */
function habitCompletionsOn(date){
  return state.habits.reduce((n,h)=> n + (h.completions[date] ? 1 : 0), 0);
}
function checklistFor(date){ return state.checklist[date] || []; }
function checklistDoneOn(date){ return checklistFor(date).filter(t=>t.done).length; }

function activityScore(date){
  let s = 0;
  s += habitCompletionsOn(date);
  s += checklistDoneOn(date);
  if(state.mood[date]) s += 1;
  if(state.water[date]) s += 1;
  if(state.sleep[date]) s += 1;
  if(state.journal[date] && state.journal[date].text && state.journal[date].text.trim()) s += 1;
  return s;
}
function levelForScore(s){
  if(s<=0) return 0;
  if(s<=2) return 1;
  if(s<=4) return 2;
  if(s<=6) return 3;
  return 4;
}

/* Completion % for a given day = (habits done + checklist done) / (habits total + checklist total) */
function dayCompletionPct(date){
  const totalHabits = state.habits.length;
  const doneHabits = habitCompletionsOn(date);
  const items = checklistFor(date);
  const totalItems = items.length;
  const doneItems = items.filter(t=>t.done).length;
  const total = totalHabits + totalItems;
  if(total === 0) return null;
  return Math.round(((doneHabits + doneItems) / total) * 100);
}

/* -------------------------------------------------------------------------- */
/* Heatmap renderer                                                           */
/* -------------------------------------------------------------------------- */
function renderHeatmap(containerId, weeks){
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const grid = el("div", { class:"heatmap" });
  const today = new Date();
  // Build a flat list of the last weeks*7 days ending on the upcoming Saturday,
  // then lay them out column-by-column (7 rows = Sun..Sat) via CSS grid-auto-flow:column.
  const days = [];
  const daysNeeded = weeks * 7;
  const alignEnd = addDays(today, 6 - today.getDay()); // upcoming Saturday
  for(let i = daysNeeded - 1; i >= 0; i--){
    days.push(addDays(alignEnd, -i));
  }
  for(let w = 0; w < weeks; w++){
    for(let d = 0; d < 7; d++){
      const day = days[w*7 + d];
      if(!day) continue;
      const ds = dateStr(day);
      const isFuture = day > today;
      const score = isFuture ? -1 : activityScore(ds);
      const level = isFuture ? 0 : levelForScore(score);
      const cell = el("div", {
        class: "heat-cell",
        "data-level": String(level),
        title: isFuture ? "" : `${friendlyDate(ds)} — ${score} action${score===1?"":"s"} logged`,
        style: isFuture ? "opacity:.35;" : ""
      });
      grid.appendChild(cell);
    }
  }
  container.appendChild(grid);
}

/* -------------------------------------------------------------------------- */
/* Bar chart renderer                                                        */
/* -------------------------------------------------------------------------- */
function renderBars(containerId, items, opts={}){
  // items: [{label, value, display}]
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const max = opts.max || Math.max(1, ...items.map(i=>i.value));
  items.forEach(it=>{
    const pct = Math.max(2, Math.min(100, (it.value / max) * 100));
    const col = el("div", { class:"bar-col" }, [
      el("span", { class:"bar-val" }, it.display !== undefined ? String(it.display) : String(it.value)),
      el("div", { class:"bar-track" }, [ el("div", { class:"bar-fill", style:`height:${pct}%` }) ]),
      el("span", { class:"bar-label" }, it.label)
    ]);
    container.appendChild(col);
  });
  if(items.length===0){
    container.appendChild(el("p", {class:"muted small"}, "Not enough data yet."));
  }
}

/* ============================================================================
   DASHBOARD
   ============================================================================ */
function renderDashboard(){
  const today = todayStr();

  // Summary stat cards
  const summary = document.getElementById("dashSummary");
  summary.innerHTML = "";
  const habitsDone = habitCompletionsOn(today);
  const habitsTotal = state.habits.length;
  const checklistItems = checklistFor(today);
  const checklistDone = checklistItems.filter(t=>t.done).length;
  const streaks = state.habits.map(h=> currentStreak(h));
  const bestStreak = streaks.length ? Math.max(...streaks) : 0;
  const moodToday = state.mood[today];
  const waterToday = state.water[today] || 0;

  const cards = [
    { label:"Habits today", value: habitsTotal ? `${habitsDone}/${habitsTotal}` : "—", cls:"accent" },
    { label:"Tasks today", value: checklistItems.length ? `${checklistDone}/${checklistItems.length}` : "—", cls:"" },
    { label:"Best streak", value: bestStreak ? `${bestStreak}d` : "—", cls:"amber" },
    { label:"Water", value: `${waterToday}/${state.settings.waterGoal}`, cls:"" },
    { label:"Mood", value: moodToday ? moodToday.emoji : "—", cls:"" },
  ];
  cards.forEach(c=>{
    summary.appendChild(el("div", { class:"stat-card "+c.cls }, [
      el("span", { class:"stat-label" }, c.label),
      el("span", { class:"stat-value" }, c.value)
    ]));
  });

  // Today's habits
  document.getElementById("dashHabitsRatio").textContent = habitsTotal ? `${habitsDone}/${habitsTotal}` : "";
  const dashHabits = document.getElementById("dashHabits");
  dashHabits.innerHTML = "";
  if(state.habits.length === 0){
    dashHabits.appendChild(el("p", {class:"muted small"}, "No habits yet. Add one from the Habits tab."));
  } else {
    state.habits.forEach(h=>{
      const done = !!h.completions[today];
      const row = el("div", { class:"dash-habit-row" }, [
        el("button", { class:"habit-check"+(done?" is-done":""), onclick:()=>toggleHabit(h.id, today) }, done ? "✓" : ""),
        el("span", { class:"habit-name" }, `${h.emoji||"•"} ${h.name}`)
      ]);
      dashHabits.appendChild(row);
    });
  }

  // Today's checklist
  document.getElementById("dashChecklistRatio").textContent = checklistItems.length ? `${checklistDone}/${checklistItems.length}` : "";
  const dashChecklist = document.getElementById("dashChecklist");
  dashChecklist.innerHTML = "";
  if(checklistItems.length === 0){
    dashChecklist.appendChild(el("p", {class:"muted small"}, "Nothing on today's list. Add tasks from the Checklist tab."));
  } else {
    checklistItems.slice(0,6).forEach(t=>{
      dashChecklist.appendChild(el("div", { class:"check-row" }, [
        el("button", { class:"check-box"+(t.done?" is-done":""), onclick:()=>toggleChecklistItem(today, t.id) }, t.done?"✓":""),
        el("span", { class:"check-text"+(t.done?" is-done":"") }, t.text)
      ]));
    });
  }

  renderHeatmap("dashHeatmap", 12);

  // This week bars
  const weekItems = [];
  for(let i=6;i>=0;i--){
    const d = addDays(new Date(), -i);
    const ds = dateStr(d);
    const pct = dayCompletionPct(ds);
    weekItems.push({ label: DOW[d.getDay()], value: pct===null?0:pct, display: pct===null?"–":pct+"%" });
  }
  renderBars("dashWeek", weekItems, { max:100 });
}

document.getElementById("quickAdd").addEventListener("click", (e)=>{
  const btn = e.target.closest("button[data-quick]");
  if(!btn) return;
  const type = btn.dataset.quick;
  if(type==="habit") openHabitModal();
  else if(type==="task"){ showSection("checklist"); setTimeout(()=>document.getElementById("checklistInput").focus(), 100); }
  else if(type==="note") openNoteModal();
  else if(type==="journal"){ showSection("journal"); setTimeout(()=>document.getElementById("journalInput").focus(), 100); }
  else if(type==="goal") openGoalModal();
});

/* ============================================================================
   HABITS
   ============================================================================ */
function currentStreak(habit){
  let streak = 0;
  let d = new Date();
  // if today not done yet, streak counts backward from yesterday
  if(!habit.completions[todayStr()]) d = addDays(d, -1);
  while(habit.completions[dateStr(d)]){
    streak++;
    d = addDays(d, -1);
  }
  return streak;
}
function longestStreak(habit){
  const dates = Object.keys(habit.completions).filter(k=>habit.completions[k]).sort();
  if(dates.length===0) return 0;
  let best=1, cur=1;
  for(let i=1;i<dates.length;i++){
    const prev = parseDate(dates[i-1]), curD = parseDate(dates[i]);
    if(Math.round((curD-prev)/86400000)===1){ cur++; best=Math.max(best,cur); }
    else cur=1;
  }
  return Math.max(best, cur);
}
function toggleHabit(id, date){
  const h = state.habits.find(x=>x.id===id);
  if(!h) return;
  if(h.completions[date]) delete h.completions[date];
  else h.completions[date] = true;
  save();
  renderSection(currentActiveSection());
}
function currentActiveSection(){
  const active = document.querySelector(".view.is-active");
  return active ? active.id.replace("view-","") : "dashboard";
}

const HABIT_EMOJIS = ["💪","📚","🧘","🏃","💧","🥗","😴","🎯","✍️","🎸","🧹","💰","🚭","🌱","🧠","☀️"];

function openHabitModal(existing){
  const body = el("div", {});
  const nameField = el("div", {class:"field"}, [
    el("label",{},"Habit name"),
    el("input",{type:"text", id:"habitNameInput", placeholder:"e.g. Read 10 pages", value: existing? existing.name : ""})
  ]);
  let selectedEmoji = existing ? existing.emoji : HABIT_EMOJIS[0];
  const emojiRow = el("div", {class:"emoji-pick", id:"habitEmojiPick"});
  HABIT_EMOJIS.forEach(em=>{
    const b = el("button", {type:"button", class: em===selectedEmoji?"is-active":"", onclick:(e)=>{
      selectedEmoji = em;
      emojiRow.querySelectorAll("button").forEach(x=>x.classList.remove("is-active"));
      e.currentTarget.classList.add("is-active");
    }}, em);
    emojiRow.appendChild(b);
  });
  const emojiField = el("div",{class:"field"},[ el("label",{},"Icon"), emojiRow ]);

  const actions = el("div", {class:"modal-actions"}, [
    existing ? el("button", {class:"btn btn-danger", onclick:()=>{ deleteHabit(existing.id); closeModal(); }}, "Delete") : null,
    el("button", {class:"btn btn-primary", onclick:()=>{
      const name = document.getElementById("habitNameInput").value.trim();
      if(!name){ toast("Give the habit a name."); return; }
      if(existing){ existing.name = name; existing.emoji = selectedEmoji; }
      else state.habits.push({ id: uid(), name, emoji: selectedEmoji, createdAt: todayStr(), completions:{} });
      save(); closeModal(); renderSection("habits"); renderDashboard();
      toast(existing ? "Habit updated." : "Habit added.");
    }}, existing ? "Save" : "Add habit")
  ]);
  body.appendChild(nameField); body.appendChild(emojiField); body.appendChild(actions);
  openModal(existing ? "Edit habit" : "New habit", body);
}
function deleteHabit(id){
  state.habits = state.habits.filter(h=>h.id!==id);
  save(); renderSection("habits"); renderDashboard();
  toast("Habit deleted.");
}
document.getElementById("addHabitBtn").addEventListener("click", ()=>openHabitModal());

function miniHeat(habit, days){
  const wrap = el("div", { class:"habit-mini-heat" });
  for(let i=days-1;i>=0;i--){
    const ds = dateStr(addDays(new Date(), -i));
    const done = !!habit.completions[ds];
    wrap.appendChild(el("div", { style:`width:6px;height:14px;border-radius:2px;background:${done?"var(--accent)":"var(--surface-2)"};`, title:ds }));
  }
  return wrap;
}

function renderHabits(){
  const list = document.getElementById("habitsList");
  list.innerHTML = "";
  document.getElementById("habitsEmpty").hidden = state.habits.length > 0;
  const today = todayStr();
  state.habits.forEach(h=>{
    const done = !!h.completions[today];
    const streak = currentStreak(h);
    const row = el("div", { class:"habit-row" }, [
      el("button", { class:"habit-check"+(done?" is-done":""), onclick:()=>toggleHabit(h.id, today) }, done?"✓":""),
      el("div", { class:"habit-info" }, [
        el("div", { class:"habit-name" }, `${h.emoji||"•"} ${h.name}`),
        el("div", { class:"habit-meta" }, `Longest streak: ${longestStreak(h)} days · Started ${shortDate(h.createdAt)}`)
      ]),
      miniHeat(h, 14),
      el("div", { class:"habit-streak" }, streak>0 ? `🔥 ${streak}` : ""),
      el("div", { class:"habit-actions" }, [
        el("button", { class:"icon-btn", title:"Edit", onclick:()=>openHabitModal(h) }, "✎")
      ])
    ]);
    list.appendChild(row);
  });
}

/* ============================================================================
   CHECKLIST
   ============================================================================ */
function toggleChecklistItem(date, id){
  const items = state.checklist[date] || [];
  const it = items.find(x=>x.id===id);
  if(it){ it.done = !it.done; save(); renderSection(currentActiveSection()); renderDashboard(); }
}
function renderChecklist(){
  const today = todayStr();
  document.getElementById("checklistDateLabel").textContent = friendlyDate(today);
  const items = state.checklist[today] || [];
  const done = items.filter(t=>t.done).length;
  document.getElementById("checklistRatio").textContent = items.length ? `${done}/${items.length} done` : "";
  const list = document.getElementById("checklistList");
  list.innerHTML = "";
  document.getElementById("checklistEmpty").hidden = items.length > 0;
  items.forEach(t=>{
    list.appendChild(el("div", { class:"check-row" }, [
      el("button", { class:"check-box"+(t.done?" is-done":""), onclick:()=>toggleChecklistItem(today, t.id) }, t.done?"✓":""),
      el("span", { class:"check-text"+(t.done?" is-done":"") }, t.text),
      el("button", { class:"check-del", title:"Delete", onclick:()=>{
        state.checklist[today] = (state.checklist[today]||[]).filter(x=>x.id!==t.id);
        save(); renderChecklist(); renderDashboard();
      } }, "✕")
    ]));
  });
}
document.getElementById("checklistForm").addEventListener("submit", (e)=>{
  e.preventDefault();
  const input = document.getElementById("checklistInput");
  const text = input.value.trim();
  if(!text) return;
  const today = todayStr();
  if(!state.checklist[today]) state.checklist[today] = [];
  state.checklist[today].push({ id: uid(), text, done:false });
  input.value = "";
  save(); renderChecklist(); renderDashboard();
});

/* ============================================================================
   CALENDAR
   ============================================================================ */
let calCursor = new Date();
let calSelected = todayStr();

function renderCalendar(){
  document.getElementById("calMonthLabel").textContent = `${MONTHS[calCursor.getMonth()]} ${calCursor.getFullYear()}`;
  const grid = document.getElementById("calGrid");
  grid.innerHTML = "";
  DOW.forEach(d=> grid.appendChild(el("div", {class:"cal-dow"}, d)));

  const first = new Date(calCursor.getFullYear(), calCursor.getMonth(), 1);
  const startPad = first.getDay();
  const daysInMonth = new Date(calCursor.getFullYear(), calCursor.getMonth()+1, 0).getDate();

  for(let i=0;i<startPad;i++) grid.appendChild(el("div", {class:"cal-cell is-pad"}));

  const today = todayStr();
  for(let day=1; day<=daysInMonth; day++){
    const d = new Date(calCursor.getFullYear(), calCursor.getMonth(), day);
    const ds = dateStr(d);
    const dots = [];
    if(habitCompletionsOn(ds)>0) dots.push(el("span",{class:"cal-dot", style:"background:var(--accent)"}));
    if(checklistDoneOn(ds)>0) dots.push(el("span",{class:"cal-dot", style:"background:var(--violet)"}));
    if(state.mood[ds]) dots.push(el("span",{class:"cal-dot", style:"background:var(--amber)"}));
    if(state.journal[ds] && state.journal[ds].text) dots.push(el("span",{class:"cal-dot", style:"background:var(--danger)"}));

    const classes = ["cal-cell","is-day"];
    if(ds===today) classes.push("is-today");
    if(ds===calSelected) classes.push("is-selected");
    const cell = el("div", { class:classes.join(" "), onclick:()=>{ calSelected=ds; renderCalendar(); } }, [
      el("span",{}, String(day)),
      el("div",{class:"cal-dots"}, dots)
    ]);
    grid.appendChild(cell);
  }
  renderCalDetail();
}
function renderCalDetail(){
  document.getElementById("calDetailDate").textContent = friendlyDate(calSelected);
  const body = document.getElementById("calDetailBody");
  body.innerHTML = "";
  const habitsDone = state.habits.filter(h=>h.completions[calSelected]);
  const items = checklistFor(calSelected);
  const mood = state.mood[calSelected];
  const water = state.water[calSelected];
  const sleep = state.sleep[calSelected];
  const journal = state.journal[calSelected];

  const rows = [];
  if(habitsDone.length) rows.push(`✓ Habits: ${habitsDone.map(h=>h.emoji+" "+h.name).join(", ")}`);
  if(items.length) rows.push(`☑ Checklist: ${items.filter(i=>i.done).length}/${items.length} completed`);
  if(mood) rows.push(`${mood.emoji} Mood: ${mood.label}`);
  if(water) rows.push(`💧 Water: ${water} glasses`);
  if(sleep) rows.push(`😴 Sleep: ${sleep} hours`);
  if(journal && journal.text) rows.push(`📖 Journal entry written`);

  if(rows.length===0){
    body.appendChild(el("p", {class:"muted small"}, "Nothing logged on this day."));
  } else {
    rows.forEach(r=> body.appendChild(el("p", {class:"small"}, r)));
  }
}
document.getElementById("calPrev").addEventListener("click", ()=>{ calCursor = addMonths(calCursor, -1); renderCalendar(); });
document.getElementById("calNext").addEventListener("click", ()=>{ calCursor = addMonths(calCursor, 1); renderCalendar(); });

/* ============================================================================
   MOOD
   ============================================================================ */
const MOODS = [
  { emoji:"😄", label:"Great", value:5 },
  { emoji:"🙂", label:"Good", value:4 },
  { emoji:"😐", label:"Okay", value:3 },
  { emoji:"😔", label:"Low", value:2 },
  { emoji:"😣", label:"Rough", value:1 },
];
function setMood(m){
  state.mood[todayStr()] = m;
  save(); renderMood(); renderDashboard();
}
function renderMood(){
  const today = todayStr();
  const picker = document.getElementById("moodPicker");
  picker.innerHTML = "";
  const current = state.mood[today];
  MOODS.forEach(m=>{
    picker.appendChild(el("button", {
      class:"mood-opt"+(current && current.value===m.value ? " is-active":""),
      onclick:()=>setMood(m)
    }, [ document.createTextNode(m.emoji), el("span",{class:"label"}, m.label) ]));
  });

  const hist = document.getElementById("moodHistory");
  hist.innerHTML = "";
  for(let i=13;i>=0;i--){
    const d = addDays(new Date(), -i);
    const ds = dateStr(d);
    const mood = state.mood[ds];
    hist.appendChild(el("div", {class:"mood-hist-item"}, [
      el("span", {class:"mood-hist-emoji"}, mood ? mood.emoji : "·"),
      el("span", {class:"mood-hist-day"}, String(d.getDate()))
    ]));
  }

  const statsBox = document.getElementById("moodStats");
  statsBox.innerHTML = "";
  const allMoods = Object.values(state.mood);
  if(allMoods.length===0){
    statsBox.appendChild(el("p",{class:"muted small"}, "Log your mood to see trends here."));
  } else {
    const avg = allMoods.reduce((s,m)=>s+m.value,0)/allMoods.length;
    const last7 = [];
    for(let i=6;i>=0;i--){ const ds=dateStr(addDays(new Date(),-i)); if(state.mood[ds]) last7.push(state.mood[ds].value); }
    const avg7 = last7.length ? last7.reduce((a,b)=>a+b,0)/last7.length : null;
    statsBox.appendChild(el("p",{class:"small"}, `All-time average: ${avg.toFixed(1)} / 5`));
    statsBox.appendChild(el("p",{class:"small"}, avg7 ? `Last 7 days average: ${avg7.toFixed(1)} / 5` : "Not enough entries this week yet."));
    statsBox.appendChild(el("p",{class:"small"}, `Total check-ins: ${allMoods.length}`));
  }
}

/* ============================================================================
   WELLNESS: WATER + SLEEP
   ============================================================================ */
function renderWellness(){
  const today = todayStr();
  document.getElementById("waterGoalInput").value = state.settings.waterGoal;
  document.getElementById("sleepGoalInput").value = state.settings.sleepGoal;

  const count = state.water[today] || 0;
  document.getElementById("waterRatio").textContent = `${count}/${state.settings.waterGoal}`;
  const tracker = document.getElementById("waterTracker");
  tracker.innerHTML = "";
  const max = Math.max(state.settings.waterGoal, count);
  for(let i=1;i<=max;i++){
    const filled = i<=count;
    tracker.appendChild(el("button", {
      class:"water-glass"+(filled?" is-filled":""),
      onclick:()=>{ state.water[today] = filled ? i-1 : i; save(); renderWellness(); renderDashboard(); }
    }, "💧"));
  }
  tracker.appendChild(el("button", { class:"icon-btn", title:"Add a glass", onclick:()=>{
    state.water[today] = (state.water[today]||0) + 1; save(); renderWellness(); renderDashboard();
  } }, "+"));

  // charts
  const waterItems = [];
  const sleepItems = [];
  for(let i=6;i>=0;i--){
    const d = addDays(new Date(), -i);
    const ds = dateStr(d);
    waterItems.push({ label: DOW[d.getDay()], value: state.water[ds]||0, display: state.water[ds]||0 });
    sleepItems.push({ label: DOW[d.getDay()], value: state.sleep[ds]||0, display: state.sleep[ds] ? state.sleep[ds]+"h" : "–" });
  }
  renderBars("waterChart", waterItems, { max: Math.max(state.settings.waterGoal, ...waterItems.map(i=>i.value), 1) });
  renderBars("sleepChart", sleepItems, { max: Math.max(state.settings.sleepGoal, ...sleepItems.map(i=>i.value), 1) });
}
document.getElementById("waterGoalInput").addEventListener("change", (e)=>{
  const v = Math.max(1, parseInt(e.target.value)||8);
  state.settings.waterGoal = v; save(); renderWellness();
});
document.getElementById("sleepGoalInput").addEventListener("change", (e)=>{
  const v = Math.max(1, parseFloat(e.target.value)||8);
  state.settings.sleepGoal = v; save(); renderWellness();
});
document.getElementById("sleepForm").addEventListener("submit", (e)=>{
  e.preventDefault();
  const input = document.getElementById("sleepInput");
  const v = parseFloat(input.value);
  if(isNaN(v) || v<0){ toast("Enter a valid number of hours."); return; }
  state.sleep[todayStr()] = v;
  input.value="";
  save(); renderWellness(); renderDashboard();
  toast("Sleep logged.");
});

/* ============================================================================
   POMODORO
   ============================================================================ */
let pomo = {
  mode: "focus",       // focus | break | long
  remaining: 0,         // seconds
  running: false,
  intervalId: null,
  sessionCount: 0
};
function pomoDurationSec(mode){
  const s = state.settings.pomodoro;
  if(mode==="focus") return s.focus*60;
  if(mode==="break") return s.brk*60;
  return s.long*60;
}
function initPomo(){
  pomo.remaining = pomoDurationSec(pomo.mode);
}
initPomo();

function fmtTime(sec){
  const m = Math.floor(sec/60), s = sec%60;
  return `${pad(m)}:${pad(s)}`;
}
const RING_CIRC = 2 * Math.PI * 100;
function updatePomoDisplay(){
  document.getElementById("pomodoroTime").textContent = fmtTime(pomo.remaining);
  const label = pomo.mode==="focus" ? "Focus" : pomo.mode==="break" ? "Short break" : "Long break";
  document.getElementById("pomodoroModeLabel").textContent = label;
  const total = pomoDurationSec(pomo.mode);
  const frac = total>0 ? pomo.remaining/total : 0;
  const ring = document.getElementById("pomodoroRing");
  ring.style.strokeDasharray = String(RING_CIRC);
  ring.style.strokeDashoffset = String(RING_CIRC * (1-frac));
  ring.style.stroke = pomo.mode==="focus" ? "var(--accent)" : "var(--violet)";
  document.getElementById("pomodoroToggle").textContent = pomo.running ? "Pause" : "Start";
}
function tickPomo(){
  pomo.remaining--;
  if(pomo.remaining<=0){
    if(pomo.mode==="focus"){
      logPomodoroSession(state.settings.pomodoro.focus);
      pomo.sessionCount++;
      const isLong = pomo.sessionCount % state.settings.pomodoro.longEvery === 0;
      pomo.mode = isLong ? "long" : "break";
    } else {
      pomo.mode = "focus";
    }
    initPomo();
    toast(pomo.mode==="focus" ? "Break's over — back to focus." : "Nice work — take a break.");
    if("Notification" in window){} // no permission prompts; keep silent, offline-friendly
  }
  updatePomoDisplay();
}
function startPomo(){
  if(pomo.running) return;
  pomo.running = true;
  pomo.intervalId = setInterval(tickPomo, 1000);
  updatePomoDisplay();
}
function pausePomo(){
  pomo.running = false;
  clearInterval(pomo.intervalId);
  updatePomoDisplay();
}
function resetPomo(){
  pausePomo();
  pomo.mode = "focus";
  initPomo();
  updatePomoDisplay();
}
function skipPomo(){
  pausePomo();
  if(pomo.mode==="focus"){
    pomo.sessionCount++;
    const isLong = pomo.sessionCount % state.settings.pomodoro.longEvery === 0;
    pomo.mode = isLong ? "long" : "break";
  } else pomo.mode = "focus";
  initPomo();
  updatePomoDisplay();
}
function logPomodoroSession(minutes){
  state.pomodoro.sessions.push({ id: uid(), date: todayStr(), minutes, type:"focus" });
  save();
  if(document.getElementById("view-pomodoro").classList.contains("is-active")) renderPomodoroStats();
  renderDashboard();
}
document.getElementById("pomodoroToggle").addEventListener("click", ()=> pomo.running ? pausePomo() : startPomo());
document.getElementById("pomodoroReset").addEventListener("click", resetPomo);
document.getElementById("pomodoroSkip").addEventListener("click", skipPomo);

function wirePomoSetting(id, key){
  document.getElementById(id).addEventListener("change", (e)=>{
    const v = Math.max(1, parseInt(e.target.value)||1);
    state.settings.pomodoro[key] = v;
    save();
    if(!pomo.running) { initPomo(); updatePomoDisplay(); }
  });
}
wirePomoSetting("focusLenInput","focus");
wirePomoSetting("breakLenInput","brk");
wirePomoSetting("longBreakLenInput","long");

function renderPomodoroStats(){
  const today = todayStr();
  const todaySessions = state.pomodoro.sessions.filter(s=>s.date===today);
  const todayMinutes = todaySessions.reduce((a,s)=>a+s.minutes,0);
  const box = document.getElementById("pomodoroTodayStats");
  box.innerHTML = "";
  box.appendChild(el("p",{class:"small"}, `Sessions completed: ${todaySessions.length}`));
  box.appendChild(el("p",{class:"small"}, `Focused time: ${todayMinutes} minutes`));

  const items = [];
  for(let i=6;i>=0;i--){
    const d = addDays(new Date(), -i);
    const ds = dateStr(d);
    const mins = state.pomodoro.sessions.filter(s=>s.date===ds).reduce((a,s)=>a+s.minutes,0);
    items.push({ label: DOW[d.getDay()], value: mins, display: mins ? mins+"m" : "–" });
  }
  renderBars("pomodoroWeekChart", items);
}
function renderPomodoroView(){
  document.getElementById("focusLenInput").value = state.settings.pomodoro.focus;
  document.getElementById("breakLenInput").value = state.settings.pomodoro.brk;
  document.getElementById("longBreakLenInput").value = state.settings.pomodoro.long;
  updatePomoDisplay();
  renderPomodoroStats();
}

/* ============================================================================
   NOTES
   ============================================================================ */
function openNoteModal(existing){
  const body = el("div", {});
  const titleField = el("div",{class:"field"},[ el("label",{},"Title"), el("input",{type:"text", id:"noteTitleInput", placeholder:"Note title", value: existing?existing.title:""}) ]);
  const contentField = el("div",{class:"field"},[ el("label",{},"Content"), el("textarea",{id:"noteContentInput", rows:"6", placeholder:"Write it down…"}, existing?existing.content:"") ]);
  const actions = el("div",{class:"modal-actions"},[
    existing ? el("button",{class:"btn btn-danger", onclick:()=>{ deleteNote(existing.id); closeModal(); }}, "Delete") : null,
    el("button",{class:"btn btn-primary", onclick:()=>{
      const title = document.getElementById("noteTitleInput").value.trim() || "Untitled note";
      const content = document.getElementById("noteContentInput").value.trim();
      if(existing){ existing.title=title; existing.content=content; existing.updatedAt=Date.now(); }
      else state.notes.unshift({ id: uid(), title, content, createdAt:Date.now(), updatedAt:Date.now() });
      save(); closeModal(); renderNotes();
      toast(existing?"Note updated.":"Note added.");
    }}, existing?"Save":"Add note")
  ]);
  body.appendChild(titleField); body.appendChild(contentField); body.appendChild(actions);
  openModal(existing?"Edit note":"New note", body);
}
function deleteNote(id){ state.notes = state.notes.filter(n=>n.id!==id); save(); renderNotes(); toast("Note deleted."); }
function renderNotes(){
  const grid = document.getElementById("notesGrid");
  grid.innerHTML = "";
  document.getElementById("notesEmpty").hidden = state.notes.length>0;
  state.notes.forEach(n=>{
    grid.appendChild(el("div", { class:"note-card", onclick:()=>openNoteModal(n) }, [
      el("div", {class:"note-title"}, n.title),
      el("div", {class:"note-preview"}, n.content || "No content"),
      el("div", {class:"note-date"}, new Date(n.updatedAt).toLocaleDateString())
    ]));
  });
}
document.getElementById("addNoteBtn").addEventListener("click", ()=>openNoteModal());

/* ============================================================================
   JOURNAL
   ============================================================================ */
function renderJournal(){
  const today = todayStr();
  document.getElementById("journalDateLabel").textContent = `Today's entry — ${friendlyDate(today)}`;
  const entry = state.journal[today];
  document.getElementById("journalInput").value = entry ? entry.text : "";
  document.getElementById("journalSavedLabel").textContent = entry ? `Saved ${new Date(entry.updatedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : "";

  const list = document.getElementById("journalList");
  list.innerHTML = "";
  const dates = Object.keys(state.journal).filter(d=>state.journal[d].text && state.journal[d].text.trim() && d!==today).sort().reverse();
  document.getElementById("journalEmpty").hidden = dates.length>0;
  dates.forEach(ds=>{
    list.appendChild(el("div", {class:"journal-entry"}, [
      el("div", {class:"journal-entry-date"}, friendlyDate(ds)),
      el("div", {class:"journal-entry-text"}, state.journal[ds].text)
    ]));
  });
}
document.getElementById("journalSaveBtn").addEventListener("click", ()=>{
  const text = document.getElementById("journalInput").value;
  state.journal[todayStr()] = { text, updatedAt: Date.now() };
  save(); renderJournal(); renderDashboard();
  toast("Journal entry saved.");
});

/* ============================================================================
   GOALS
   ============================================================================ */
function openGoalModal(existing){
  const body = el("div", {});
  const titleField = el("div",{class:"field"},[ el("label",{},"Goal"), el("input",{type:"text", id:"goalTitleInput", placeholder:"e.g. Read 12 books this year", value: existing?existing.title:""}) ]);
  const row = el("div", {class:"field-row"}, [
    el("div",{class:"field"},[ el("label",{},"Target"), el("input",{type:"number", id:"goalTargetInput", min:"1", value: existing?existing.target:10}) ]),
    el("div",{class:"field"},[ el("label",{},"Unit"), el("input",{type:"text", id:"goalUnitInput", placeholder:"books, km, $…", value: existing?existing.unit:""}) ])
  ]);
  const deadlineField = el("div",{class:"field"},[ el("label",{},"Deadline (optional)"), el("input",{type:"date", id:"goalDeadlineInput", value: existing&&existing.deadline?existing.deadline:""}) ]);
  const actions = el("div",{class:"modal-actions"},[
    existing ? el("button",{class:"btn btn-danger", onclick:()=>{ deleteGoal(existing.id); closeModal(); }}, "Delete") : null,
    el("button",{class:"btn btn-primary", onclick:()=>{
      const title = document.getElementById("goalTitleInput").value.trim();
      const target = Math.max(1, parseFloat(document.getElementById("goalTargetInput").value)||1);
      const unit = document.getElementById("goalUnitInput").value.trim();
      const deadline = document.getElementById("goalDeadlineInput").value || null;
      if(!title){ toast("Give the goal a title."); return; }
      if(existing){ existing.title=title; existing.target=target; existing.unit=unit; existing.deadline=deadline; }
      else state.goals.push({ id: uid(), title, target, unit, current:0, deadline, createdAt: todayStr(), completedAt:null });
      save(); closeModal(); renderGoals();
      toast(existing?"Goal updated.":"Goal added.");
    }}, existing?"Save":"Add goal")
  ]);
  body.appendChild(titleField); body.appendChild(row); body.appendChild(deadlineField); body.appendChild(actions);
  openModal(existing?"Edit goal":"New goal", body);
}
function deleteGoal(id){ state.goals = state.goals.filter(g=>g.id!==id); save(); renderGoals(); toast("Goal deleted."); }
function bumpGoal(id, delta){
  const g = state.goals.find(x=>x.id===id);
  if(!g) return;
  g.current = Math.max(0, Math.min(g.target, g.current+delta));
  g.completedAt = g.current>=g.target ? (g.completedAt||todayStr()) : null;
  save(); renderGoals();
}
function renderGoals(){
  const list = document.getElementById("goalsList");
  list.innerHTML = "";
  document.getElementById("goalsEmpty").hidden = state.goals.length>0;
  state.goals.forEach(g=>{
    const pct = Math.min(100, Math.round((g.current/g.target)*100));
    const done = g.current>=g.target;
    list.appendChild(el("div", {class:"goal-card"}, [
      el("div", {class:"goal-top"}, [
        el("span", {class:"goal-title"+(done?" is-done":"")}, (done?"🏆 ":"")+g.title),
        el("button", {class:"icon-btn", title:"Edit", onclick:()=>openGoalModal(g)}, "✎")
      ]),
      el("div", {class:"goal-progress-track"}, [ el("div", {class:"goal-progress-fill", style:`width:${pct}%`}) ]),
      el("div", {class:"goal-meta-row"}, [
        el("span", {}, `${g.current}${g.unit?" "+g.unit:""} of ${g.target}${g.unit?" "+g.unit:""} (${pct}%)`),
        el("div", {class:"goal-controls"}, [
          el("button", {onclick:()=>bumpGoal(g.id,-1)}, "–"),
          el("button", {onclick:()=>bumpGoal(g.id,1)}, "+")
        ])
      ]),
      g.deadline ? el("div", {class:"goal-meta-row"}, [ el("span",{},`Deadline: ${shortDate(g.deadline)}`) ]) : null
    ]));
  });
}
document.getElementById("addGoalBtn").addEventListener("click", ()=>openGoalModal());

/* ============================================================================
   STATISTICS
   ============================================================================ */
function renderStats(){
  const summary = document.getElementById("statsSummary");
  summary.innerHTML = "";
  const totalHabitChecks = state.habits.reduce((n,h)=>n+Object.values(h.completions).filter(Boolean).length,0);
  const totalChecklistDone = Object.values(state.checklist).reduce((n,items)=>n+items.filter(t=>t.done).length,0);
  const totalJournalEntries = Object.values(state.journal).filter(j=>j.text && j.text.trim()).length;
  const totalPomodoroMinutes = state.pomodoro.sessions.reduce((a,s)=>a+s.minutes,0);
  const goalsCompleted = state.goals.filter(g=>g.completedAt).length;
  const moodValues = Object.values(state.mood).map(m=>m.value);
  const avgMood = moodValues.length ? (moodValues.reduce((a,b)=>a+b,0)/moodValues.length).toFixed(1) : "—";

  [
    {label:"Habit check-ins", value: totalHabitChecks, cls:"accent"},
    {label:"Tasks completed", value: totalChecklistDone, cls:""},
    {label:"Journal entries", value: totalJournalEntries, cls:""},
    {label:"Focused minutes", value: totalPomodoroMinutes, cls:"amber"},
    {label:"Goals completed", value: `${goalsCompleted}/${state.goals.length}`, cls:""},
    {label:"Average mood", value: avgMood==="—"?"—":avgMood+"/5", cls:""},
  ].forEach(c=>{
    summary.appendChild(el("div", {class:"stat-card "+c.cls}, [
      el("span",{class:"stat-label"}, c.label),
      el("span",{class:"stat-value"}, String(c.value))
    ]));
  });

  renderHeatmap("statsHeatmap", 26);

  const weekly = [];
  for(let i=6;i>=0;i--){
    const d = addDays(new Date(),-i); const ds = dateStr(d);
    const pct = dayCompletionPct(ds);
    weekly.push({label: DOW[d.getDay()], value: pct===null?0:pct, display: pct===null?"–":pct+"%"});
  }
  renderBars("statsWeekly", weekly, {max:100});

  const monthly = [];
  for(let i=5;i>=0;i--){
    const monthDate = addMonths(new Date(), -i);
    const y = monthDate.getFullYear(), m = monthDate.getMonth();
    const daysCount = new Date(y, m+1, 0).getDate();
    const isCurrentMonth = i===0;
    const lastDay = isCurrentMonth ? new Date().getDate() : daysCount;
    let sum=0, n=0;
    for(let d=1; d<=lastDay; d++){
      const ds = `${y}-${pad(m+1)}-${pad(d)}`;
      const pct = dayCompletionPct(ds);
      if(pct!==null){ sum+=pct; n++; }
    }
    const avg = n ? Math.round(sum/n) : 0;
    monthly.push({label: MONTHS[m].slice(0,3), value: avg, display: n? avg+"%":"–"});
  }
  renderBars("statsMonthly", monthly, {max:100});

  const streakBox = document.getElementById("statsStreaks");
  streakBox.innerHTML = "";
  if(state.habits.length===0){
    streakBox.appendChild(el("p",{class:"muted small"},"Add habits to see streaks here."));
  } else {
    state.habits.slice().sort((a,b)=>currentStreak(b)-currentStreak(a)).forEach(h=>{
      streakBox.appendChild(el("div", {class:"habit-meta", style:"display:flex;justify-content:space-between;"}, [
        el("span",{}, `${h.emoji||"•"} ${h.name}`),
        el("span",{class:"mono"}, `🔥 ${currentStreak(h)} · best ${longestStreak(h)}`)
      ]));
    });
  }

  const overviewBox = document.getElementById("statsOverview");
  overviewBox.innerHTML = "";
  const daysTracked = new Set([
    ...Object.keys(state.mood), ...Object.keys(state.water), ...Object.keys(state.sleep),
    ...Object.keys(state.checklist), ...Object.keys(state.journal),
    ...state.habits.flatMap(h=>Object.keys(h.completions))
  ]).size;
  [
    `Days with activity logged: ${daysTracked}`,
    `Total habits tracked: ${state.habits.length}`,
    `Total notes: ${state.notes.length}`,
    `Total goals: ${state.goals.length}`,
    `Total pomodoro sessions: ${state.pomodoro.sessions.length}`,
  ].forEach(t=> overviewBox.appendChild(el("p",{class:"small"}, t)));
}

/* ============================================================================
   SEARCH
   ============================================================================ */
const searchInput = document.getElementById("searchInput");
let lastSection = "dashboard";
searchInput.addEventListener("input", ()=>{
  const q = searchInput.value.trim().toLowerCase();
  if(!q){
    if(document.getElementById("view-search").classList.contains("is-active")) showSection(lastSection);
    return;
  }
  if(!document.getElementById("view-search").classList.contains("is-active")){
    lastSection = currentActiveSection();
  }
  runSearch(q);
});
function runSearch(q){
  document.querySelectorAll(".view").forEach(v=>v.classList.remove("is-active"));
  document.getElementById("view-search").classList.add("is-active");
  document.querySelectorAll(".nav-item,.mnav-item").forEach(b=>b.classList.remove("is-active"));
  document.getElementById("pageTitle").textContent = "Search results";
  document.getElementById("pageSubtitle").textContent = `Results for "${q}"`;

  const results = [];
  state.habits.forEach(h=>{ if(h.name.toLowerCase().includes(q)) results.push({type:"Habit", title:h.name, snip:`Streak: ${currentStreak(h)} days`, go:"habits"}); });
  state.notes.forEach(n=>{ if((n.title+" "+n.content).toLowerCase().includes(q)) results.push({type:"Note", title:n.title, snip:n.content.slice(0,90), go:"notes"}); });
  state.goals.forEach(g=>{ if(g.title.toLowerCase().includes(q)) results.push({type:"Goal", title:g.title, snip:`${g.current}/${g.target} ${g.unit||""}`, go:"goals"}); });
  Object.entries(state.journal).forEach(([ds,j])=>{ if(j.text && j.text.toLowerCase().includes(q)) results.push({type:"Journal", title:friendlyDate(ds), snip:j.text.slice(0,90), go:"journal"}); });
  Object.entries(state.checklist).forEach(([ds,items])=>{
    items.forEach(it=>{ if(it.text.toLowerCase().includes(q)) results.push({type:"Task", title:it.text, snip:friendlyDate(ds), go:"checklist"}); });
  });

  const box = document.getElementById("searchResults");
  box.innerHTML = "";
  if(results.length===0){
    box.appendChild(el("p", {class:"muted small"}, "No matches found."));
  } else {
    results.forEach(r=>{
      box.appendChild(el("div", {class:"search-result", onclick:()=>{ searchInput.value=""; showSection(r.go); }}, [
        el("div",{class:"search-result-type"}, r.type),
        el("div",{class:"search-result-title"}, r.title),
        el("div",{class:"search-result-snip"}, r.snip)
      ]));
    });
  }
}

/* ============================================================================
   INIT
   ============================================================================ */
function init(){
  applyTheme();
  showSection("dashboard");
  renderAll();
}
init();

})();
