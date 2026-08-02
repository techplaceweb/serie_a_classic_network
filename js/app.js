/* SERIE A CLASSIC NETWORK - frontend Supabase
   Nessuna password o chiave amministrativa è presente in questo file. */

const db = window.supabaseClient;
const state = {
  users: [], categories: [], contents: [], plans: [], messages: [], activity: [],
  settings: { maintenance: false, admin_email: "", expired_message: "" }
};
let sessionUser = null;
let currentAdminView = "dashboard";
let currentChatUserId = null;
let activeFrontCategory = null;

const $ = (id) => document.getElementById(id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const esc = (s = "") => String(s).replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const fmtDate = (d) => d ? new Date(d).toLocaleDateString("it-IT") : "—";
const daysBetween = (a, b) => Math.floor((new Date(b) - new Date(a)) / 86400000);

const USER_EMAIL_DOMAIN = "users.serieaclassic.local";

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function isValidUsername(value) {
  return /^[a-z0-9._-]{3,32}$/.test(normalizeUsername(value));
}

function usernameToTechnicalEmail(username) {
  return `${normalizeUsername(username)}@${USER_EMAIL_DOMAIN}`;
}


function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2600);
}
function hideAll() {
  ["loginScreen", "maintenanceScreen", "expiredScreen", "adminShell", "frontShell"]
    .forEach((id) => $(id).classList.add("hidden"));
}
function setBusy(button, busy, label = "ACCEDI") {
  button.disabled = busy;
  button.textContent = busy ? "ATTENDI..." : label;
}
async function logActivity(text) {
  await db.from("activity").insert({ text });
}

async function loadProfile(userId) {
  const { data, error } = await db.from("profiles").select("*").eq("id", userId).single();
  if (error) throw error;
  return data;
}

async function loadCommonData() {
  const [plansRes, catsRes, contentsRes, settingsRes] = await Promise.all([
    db.from("plans").select("*").order("sort_order"),
    db.from("categories").select("*").order("sort_order"),
    db.from("contents").select("*").order("created_at", { ascending: false }),
    db.from("app_settings").select("*").eq("id", 1).single()
  ]);
  if (plansRes.error) throw plansRes.error;
  if (catsRes.error) throw catsRes.error;
  if (contentsRes.error) throw contentsRes.error;
  if (settingsRes.error) throw settingsRes.error;
  state.plans = plansRes.data || [];
  state.categories = catsRes.data || [];
  state.contents = contentsRes.data || [];
  state.settings = settingsRes.data;
}

async function loadAdminData() {
  const [usersRes, activityRes, messagesRes] = await Promise.all([
    db.from("profiles").select("*").eq("role", "user").order("updated_at", { ascending: false }),
    db.from("activity").select("*").order("created_at", { ascending: false }).limit(12),
    db.from("messages").select("*").order("created_at"),
  ]);
  if (usersRes.error) throw usersRes.error;
  if (activityRes.error) throw activityRes.error;
  if (messagesRes.error) throw messagesRes.error;
  state.users = usersRes.data || [];
  state.activity = activityRes.data || [];
  state.messages = messagesRes.data || [];
}

async function refreshData() {
  await loadCommonData();
  if (sessionUser?.role === "admin") await loadAdminData();
  renderAll();
}

async function attemptLogin() {
  const loginError = $("loginError");
  const loginBtn = $("loginBtn");
  const username = normalizeUsername($("loginUser").value);
  const password = $("loginPass").value;

  loginError.classList.add("hidden");
  loginError.textContent = "";

  if (!isValidUsername(username) || !password) {
    loginError.textContent =
      "Inserisci uno username valido e la password.";
    loginError.classList.remove("hidden");
    return;
  }

  setBusy(loginBtn, true);

  try {
    const email = usernameToTechnicalEmail(username);
    const { data, error } = await db.auth.signInWithPassword({
      email,
      password
    });

    if (error || !data.user) {
      throw new Error("Username o password non corretti.");
    }

    sessionUser = await loadProfile(data.user.id);

    if (normalizeUsername(sessionUser.username) !== username) {
      await db.auth.signOut();
      throw new Error("Username o password non corretti.");
    }

    if (sessionUser.archived) {
      await db.auth.signOut();
      throw new Error("Account non attivo.");
    }

    await loadCommonData();

    if (state.settings.maintenance && sessionUser.role !== "admin") {
      return showMaintenance();
    }

    if (isTrialExpired(sessionUser)) {
      return showExpired(sessionUser);
    }

    if (sessionUser.role === "admin") {
      await loadAdminData();
      showAdmin();
    } else {
      showFrontend(sessionUser);
    }
  } catch (error) {
    console.error("Errore login:", error);
    loginError.textContent =
      error?.message || "Accesso non riuscito.";
    loginError.classList.remove("hidden");
  } finally {
    setBusy(loginBtn, false);
  }
}

async function logout() {
  await db.auth.signOut();
  sessionUser = null;
  location.reload();
}
window.logout = logout;

function isTrialExpired(user) {
  return user?.plan === "Trial" && daysBetween(user.created_at, new Date()) >= 30;
}
function showAdmin() {
  hideAll();
  $("adminShell").classList.remove("hidden");
  renderAll();
}
function showFrontend(user) {
  hideAll();
  sessionUser = user;
  $("frontShell").classList.remove("hidden");
  $("frontUserBadge").textContent = `${user.username} · ${user.plan}`;
  renderFrontend();
  showFrontHome();
}
function showMaintenance() {
  hideAll();
  $("maintenanceScreen").classList.remove("hidden");
  $("maintenanceMail").href = `mailto:${state.settings.admin_email || ""}`;
}
function showExpired(user) {
  hideAll();
  sessionUser = user;
  $("expiredScreen").classList.remove("hidden");
  $("expiredContact").href = `mailto:${state.settings.admin_email || ""}?subject=${encodeURIComponent("Abbonamento SERIE A CLASSIC")}&body=${encodeURIComponent(state.settings.expired_message || "")}`;
}

async function restoreSession() {
  try {
    const { data: { session } } = await db.auth.getSession();
    if (!session) return;
    sessionUser = await loadProfile(session.user.id);
    if (sessionUser.archived) return logout();
    await loadCommonData();
    if (state.settings.maintenance && sessionUser.role !== "admin") return showMaintenance();
    if (isTrialExpired(sessionUser)) return showExpired(sessionUser);
    if (sessionUser.role === "admin") {
      await loadAdminData();
      showAdmin();
    } else showFrontend(sessionUser);
  } catch (e) {
    console.error(e);
    await db.auth.signOut();
  }
}

function switchAdminView(v) {
  currentAdminView = v;
  document.querySelectorAll("section[id^='view-']").forEach((s) => s.classList.add("hidden"));
  $(`view-${v}`).classList.remove("hidden");
  document.querySelectorAll(".nav button").forEach((b) => b.classList.toggle("active", b.dataset.view === v));
  const titles = {
    dashboard: ["Dashboard", "Centro di controllo"], users: ["Utenti", "Accessi e abbonamenti"],
    content: ["Contenuti", "Categorie e archivio"], settings: ["Impostazioni", "Profilo, piani e sistema"]
  };
  $("pageTitle").textContent = titles[v][0];
  $("pageSubtitle").textContent = titles[v][1];
  $("sidebar").classList.remove("open");
}

function renderAll() {
  if (!sessionUser) return;
  if (sessionUser.role === "admin") {
    renderStats(); renderActivity(); renderUsers(); renderCategories(); renderContents(); renderSettings();
  }
  renderUnread();
}
function renderStats() {
  $("statUsers").textContent = state.users.length;
  $("statActive").textContent = state.users.filter((u) => !u.archived).length;
  $("statContent").textContent = state.contents.length;
  $("statCategories").textContent = state.categories.length;
}
function renderActivity() {
  const wrap = $("activityList");
  wrap.className = state.activity.length ? "" : "empty";
  wrap.innerHTML = state.activity.length
    ? state.activity.map((a) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><b>${esc(a.text)}</b><div class="subtle">${new Date(a.created_at).toLocaleString("it-IT")}</div></div>`).join("")
    : "Nessuna attività registrata.";
}
function trialInfo(u) {
  if (u.plan !== "Trial") return "";
  const left = 30 - daysBetween(u.created_at, new Date());
  return left > 0 ? `<span class="badge gold">${left} giorni rimanenti</span>` : `<span class="badge red">Scaduto da ${Math.abs(left)} giorni</span>`;
}
function renderUsers() {
  const q = ($("userSearch")?.value || "").toLowerCase();
  const f = $("userFilter")?.value || "all";
  const users = [...state.users].filter((u) => u.username.toLowerCase().includes(q) &&
    (f === "all" || (f === "archived" && u.archived) || (u.plan === f && !u.archived)));
  $("usersWrap").innerHTML = !users.length ? '<div class="empty">Nessun utente presente.</div>' :
    `<table><thead><tr><th>Username</th><th>Abbonamento</th><th>Stato</th><th>Data</th><th>Azioni</th></tr></thead><tbody>${users.map((u) =>
      `<tr style="${u.archived ? "opacity:.45" : ""}"><td><button class="icon-btn" onclick="editUser('${u.id}')">${esc(u.username)}</button></td><td>${esc(u.plan)}</td><td>${u.archived ? '<span class="badge red">Archiviato</span>' : trialInfo(u) || '<span class="badge green">Attivo</span>'}</td><td>${fmtDate(u.updated_at)}</td><td><div class="row-actions"><button class="icon-btn" onclick="toggleArchiveUser('${u.id}')">${u.archived ? "Riattiva" : "Archivia"}</button><button class="icon-btn" onclick="openAdminChatFor('${u.id}')">Chat</button><button class="icon-btn" onclick="deleteUser('${u.id}')">Elimina</button></div></td></tr>`).join("")}</tbody></table>`;
}

function modal(title, body, onSave, label = "Salva") {
  $("modalRoot").innerHTML = `<div class="modal-backdrop"><div class="modal"><h2>${esc(title)}</h2>${body}<div class="modal-actions"><button class="btn secondary" id="modalCancel">Annulla</button><button class="btn" id="modalSave">${esc(label)}</button></div></div></div>`;
  $("modalCancel").onclick = () => $("modalRoot").innerHTML = "";
  $("modalSave").onclick = onSave;
}
async function invokeAdminUsers(payload) {
  const {
    data: { session },
    error: sessionError
  } = await db.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error("Sessione amministratore non valida. Esci e accedi di nuovo.");
  }

  const { data, error } = await db.functions.invoke("admin-users", {
    body: payload,
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  });

  if (error) {
    let message = error.message || "Errore nella funzione admin-users.";
    try {
      const response = error.context;
      if (response && typeof response.json === "function") {
        const body = await response.json();
        if (body?.error) message = body.error;
      }
    } catch (_) {}
    throw new Error(message);
  }

  if (data?.error) throw new Error(data.error);
  return data;
}
function openUserModal(user = null) {
  const options = state.plans
    .map(
      (plan) =>
        `<option value="${esc(plan.name)}" ${
          user?.plan === plan.name ? "selected" : ""
        }>${esc(plan.name)}</option>`
    )
    .join("");

  modal(
    user ? "Modifica utente" : "Aggiungi utente",
    `
      <div class="form-grid">
        <div class="field">
          <label>Username</label>
          <input
            id="mUser"
            value="${esc(user?.username || "")}"
            autocomplete="off"
            autocapitalize="none"
            spellcheck="false"
          >
        </div>

        <div class="field">
          <label>
            Password ${user ? "(lascia vuoto per non cambiarla)" : ""}
          </label>
          <input
            id="mPass"
            type="password"
            minlength="8"
            autocomplete="new-password"
          >
        </div>

        <div class="field">
          <label>Abbonamento</label>
          <select id="mPlan">${options}</select>
        </div>

        <div class="field">
          <label>Stato</label>
          <select id="mStatus">
            <option value="active">Attivo</option>
            <option value="archived" ${
              user?.archived ? "selected" : ""
            }>Archiviato</option>
          </select>
        </div>
      </div>
    `,
    async () => {
      const button = $("modalSave");
      const username = normalizeUsername($("mUser").value);
      const password = $("mPass").value;

      if (!isValidUsername(username)) {
        return toast(
          "Lo username deve avere 3-32 caratteri: lettere, numeri, punto, trattino o underscore."
        );
      }

      if (!user && password.length < 8) {
        return toast("La password deve avere almeno 8 caratteri.");
      }

      if (user && password && password.length < 8) {
        return toast("La nuova password deve avere almeno 8 caratteri.");
      }

      setBusy(button, true, user ? "Salva" : "Aggiungi");

      try {
        await invokeAdminUsers({
          action: user ? "update" : "create",
          id: user?.id,
          username,
          password: password || undefined,
          plan: $("mPlan").value,
          archived: $("mStatus").value === "archived"
        });

        await logActivity(
          `${user ? "Utente modificato" : "Utente aggiunto"}: ${username}`
        );

        $("modalRoot").innerHTML = "";
        await refreshData();
        toast(user ? "Utente aggiornato." : "Utente creato.");
      } catch (error) {
        console.error("Errore gestione utente:", error);
        toast(error.message || "Operazione non riuscita.");
        setBusy(button, false, user ? "Salva" : "Aggiungi");
      }
    },
    user ? "Salva" : "Aggiungi"
  );
}

window.editUser = (id) => openUserModal(state.users.find((u) => u.id === id));
window.toggleArchiveUser = async (id) => {
  const u = state.users.find((x) => x.id === id);
  try { await invokeAdminUsers({ action: "update", id, username: u.username, plan: u.plan, archived: !u.archived }); await refreshData(); }
  catch (e) { toast(e.message); }
};
window.deleteUser = async (id) => {
  if (!confirm("Eliminare definitivamente questo utente?")) return;
  try { await invokeAdminUsers({ action: "delete", id }); await refreshData(); toast("Utente eliminato"); }
  catch (e) { toast(e.message); }
};

function orderedCategories() { return [...state.categories].sort((a, b) => a.sort_order - b.sort_order); }
function catRow(c, child) {
  const parentNames = (c.parent_ids || []).map((id) => state.categories.find((x) => x.id === id)?.name).filter(Boolean).join(", ");
  return `<div class="category-row ${child ? "child" : ""}" draggable="true" data-id="${c.id}"><span class="drag-handle">⋮⋮</span><div style="flex:1"><b>${esc(c.name)}</b><div class="subtle">${parentNames ? `Sottocategoria di ${esc(parentNames)}` : "Categoria principale"}</div></div><button class="icon-btn" onclick="editCategory('${c.id}')">Modifica</button><button class="icon-btn" onclick="deleteCategory('${c.id}')">Elimina</button></div>`;
}
function renderCategories() {
  const cats = orderedCategories();
  if (!cats.length) return $("categoriesWrap").innerHTML = '<div class="empty">Nessuna categoria creata.</div>';
  const mains = cats.filter((c) => !(c.parent_ids || []).length), children = cats.filter((c) => (c.parent_ids || []).length), rendered = [];
  mains.forEach((m) => { rendered.push(catRow(m, false)); children.filter((c) => c.parent_ids.includes(m.id)).forEach((c) => rendered.push(catRow(c, true))); });
  children.filter((c) => !c.parent_ids.some((id) => mains.some((m) => m.id === id))).forEach((c) => rendered.push(catRow(c, true)));
  $("categoriesWrap").innerHTML = rendered.join(""); enableCategoryDnD();
}
function enableCategoryDnD() {
  let dragId = null;
  document.querySelectorAll(".category-row").forEach((row) => {
    row.ondragstart = () => { dragId = row.dataset.id; row.classList.add("dragging"); };
    row.ondragend = () => row.classList.remove("dragging"); row.ondragover = (e) => e.preventDefault();
    row.ondrop = async (e) => { e.preventDefault(); const target = row.dataset.id; if (dragId === target) return;
      const arr = orderedCategories().map((c) => c.id), from = arr.indexOf(dragId), to = arr.indexOf(target); arr.splice(to, 0, arr.splice(from, 1)[0]);
      try { await Promise.all(arr.map((id, i) => db.from("categories").update({ sort_order: i, updated_at: new Date().toISOString() }).eq("id", id))); await refreshData(); } catch (err) { toast(err.message); }
    };
  });
}
function openCategoryModal(cat = null) {
  const options = state.categories.filter((c) => c.id !== cat?.id).map((c) => `<option value="${c.id}" ${cat?.parent_ids?.includes(c.id) ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  modal(cat ? "Modifica categoria" : "Nuova categoria", `<div class="field"><label>Nome categoria</label><input id="mCatName" value="${esc(cat?.name || "")}"></div><div class="field"><label>Categorie principali (selezione multipla opzionale)</label><select id="mCatParents" multiple size="6">${options}</select></div>`, async () => {
    const name = $("mCatName").value.trim(); if (!name) return toast("Inserisci il nome");
    const payload = { name, parent_ids: [...$("mCatParents").selectedOptions].map((o) => o.value), updated_at: new Date().toISOString() };
    const res = cat ? await db.from("categories").update(payload).eq("id", cat.id) : await db.from("categories").insert({ ...payload, sort_order: state.categories.length });
    if (res.error) return toast(res.error.message); $("modalRoot").innerHTML = ""; await refreshData();
  }, cat ? "Salva" : "Crea");
}
window.editCategory = (id) => openCategoryModal(state.categories.find((c) => c.id === id));
window.deleteCategory = async (id) => {
  if (!confirm("Eliminare definitivamente questa categoria?")) return;
  const res = await db.from("categories").delete().eq("id", id); if (res.error) return toast(res.error.message);
  const cats = state.categories.filter((c) => c.id !== id);
  await Promise.all(cats.filter((c) => c.parent_ids?.includes(id)).map((c) => db.from("categories").update({ parent_ids: c.parent_ids.filter((x) => x !== id) }).eq("id", c.id)));
  await Promise.all(state.contents.filter((c) => c.category_ids?.includes(id)).map((c) => db.from("contents").update({ category_ids: c.category_ids.filter((x) => x !== id) }).eq("id", c.id)));
  await refreshData();
};

function renderContents() {
  const arr = [...state.contents].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  $("contentWrap").innerHTML = !arr.length ? '<div class="empty">Nessun contenuto creato.</div>' : `<div class="content-list">${arr.map((c) => `<div class="content-row" style="${c.archived ? "opacity:.48" : ""}"><div class="mini-thumb">${c.preview ? `<img src="${c.preview}" alt="">` : "Anteprima"}</div><div class="title-wrap"><b>${esc(c.title)}</b><div class="subtle">${esc(c.description || "")}</div></div><div class="status-col">${c.archived ? '<span class="badge red">Archiviato</span>' : '<span class="badge green">Visibile</span>'}</div><div class="row-actions"><button class="icon-btn" onclick="editContent('${c.id}')">Apri</button><button class="icon-btn" onclick="toggleContent('${c.id}')">${c.archived ? "Riattiva" : "Archivia"}</button><button class="icon-btn" onclick="deleteContent('${c.id}')">Elimina</button></div></div>`).join("")}</div>`;
}
function fileData(input) { return new Promise((resolve, reject) => { const f = input.files[0]; if (!f) return resolve(""); if (f.size > 2 * 1024 * 1024) return reject(new Error("Immagine troppo grande: massimo 2 MB")); const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(f); }); }
function openContentModal(content = null) {
  modal(content ? "Modifica contenuto" : "Nuovo contenuto", `<div class="form-grid"><div class="field"><label>Titolo</label><input id="mTitle" value="${esc(content?.title || "")}"></div><div class="field"><label>URL video</label><input id="mUrl" value="${esc(content?.url || "")}"></div><div class="field"><label>Copertina (max 2 MB)</label><input id="mCover" type="file" accept="image/*"></div><div class="field"><label>Anteprima (max 2 MB)</label><input id="mPreview" type="file" accept="image/*"></div></div><div class="field"><label>Categorie e sottocategorie</label><select id="mCats" multiple size="7">${orderedCategories().map((c) => `<option value="${c.id}" ${content?.category_ids?.includes(c.id) ? "selected" : ""}>${c.parent_ids?.length ? "↳ " : ""}${esc(c.name)}</option>`).join("")}</select></div><div class="field"><label>Descrizione</label><textarea id="mDesc">${esc(content?.description || "")}</textarea></div><div class="form-grid"><label class="switch"><input id="mArchived" type="checkbox" ${content?.archived ? "checked" : ""}> Archiviato</label><label class="switch"><input id="mSubs" type="checkbox" ${content?.subscribers_only ? "checked" : ""}> Solo abbonati</label></div>`, async () => {
    try {
      const title = $("mTitle").value.trim(); if (!title) throw new Error("Inserisci un titolo");
      const cover = await fileData($("mCover")), preview = await fileData($("mPreview"));
      const payload = { title, url: $("mUrl").value.trim(), description: $("mDesc").value, category_ids: [...$("mCats").selectedOptions].map((o) => o.value), archived: $("mArchived").checked, subscribers_only: $("mSubs").checked, updated_at: new Date().toISOString() };
      if (cover) payload.cover = cover; if (preview) payload.preview = preview;
      const res = content ? await db.from("contents").update(payload).eq("id", content.id) : await db.from("contents").insert(payload);
      if (res.error) throw res.error; $("modalRoot").innerHTML = ""; await refreshData();
    } catch (e) { toast(e.message); }
  }, content ? "Salva" : "Aggiungi");
}
window.editContent = (id) => openContentModal(state.contents.find((c) => c.id === id));
window.toggleContent = async (id) => { const c = state.contents.find((x) => x.id === id); const { error } = await db.from("contents").update({ archived: !c.archived, updated_at: new Date().toISOString() }).eq("id", id); if (error) toast(error.message); else await refreshData(); };
window.deleteContent = async (id) => { if (!confirm("Eliminare definitivamente questo contenuto?")) return; const { error } = await db.from("contents").delete().eq("id", id); if (error) toast(error.message); else await refreshData(); };

function renderSettings() {
  $("adminUsername").value = sessionUser.username;
  $("adminEmail").value = state.settings.admin_email || "";
  $("expiredMessage").value = state.settings.expired_message || "";
  $("plansWrap").innerHTML = state.plans.map((p, i) => `<div class="subscription-item"><b>${esc(p.name)}</b><div class="row-actions"><button class="icon-btn" onclick="editPlan(${i})">Modifica</button><button class="icon-btn" onclick="deletePlan(${i})">Elimina</button></div></div>`).join("");
  $("maintenanceBox").innerHTML = `<button id="maintenanceBtn" class="btn ${state.settings.maintenance ? "success" : "danger"}">${state.settings.maintenance ? "DISATTIVA MODALITÀ MANUTENZIONE" : "ATTIVA MODALITÀ MANUTENZIONE"}</button>${state.settings.maintenance ? '<p class="subtle">La manutenzione è attiva per gli utenti.</p>' : ""}`;
  $("maintenanceBtn").onclick = async () => { const { error } = await db.from("app_settings").update({ maintenance: !state.settings.maintenance, updated_at: new Date().toISOString() }).eq("id", 1); if (error) toast(error.message); else await refreshData(); };
}
async function saveAdminProfile() {
  const username = normalizeUsername($("adminUsername").value);
  const password = $("adminPassword").value;

  if (!isValidUsername(username)) {
    return toast(
      "Username non valido: usa 3-32 caratteri tra lettere, numeri, punto, trattino e underscore."
    );
  }

  if (password && password.length < 8) {
    return toast("La password deve avere almeno 8 caratteri.");
  }

  try {
    await invokeAdminUsers({
      action: "update-self",
      username,
      password: password || undefined
    });

    $("adminPassword").value = "";
    sessionUser.username = username;
    toast("Profilo amministratore aggiornato.");
  } catch (error) {
    console.error(error);
    toast(error.message || "Aggiornamento non riuscito.");
  }
}

async function saveSystem() {
  const { error } = await db.from("app_settings").update({ admin_email: $("adminEmail").value.trim(), expired_message: $("expiredMessage").value, updated_at: new Date().toISOString() }).eq("id", 1);
  if (error) toast(error.message); else { await refreshData(); toast("Impostazioni salvate"); }
}
function openPlanModal(i = null) {
  const old = i === null ? null : state.plans[i];
  modal(i === null ? "Nuovo abbonamento" : "Modifica abbonamento", `<div class="field"><label>Nome</label><input id="mPlanName" value="${esc(old?.name || "")}"></div>`, async () => {
    const name = $("mPlanName").value.trim(); if (!name) return toast("Inserisci il nome");
    const res = old ? await db.from("plans").update({ name }).eq("id", old.id) : await db.from("plans").insert({ name, sort_order: state.plans.length });
    if (res.error) return toast(res.error.message);
    if (old && old.name !== name) await db.from("profiles").update({ plan: name }).eq("plan", old.name).eq("role", "user");
    $("modalRoot").innerHTML = ""; await refreshData();
  }, old ? "Salva" : "Crea");
}
window.editPlan = (i) => openPlanModal(i);
window.deletePlan = async (i) => { const p = state.plans[i]; if (state.users.some((u) => u.plan === p.name)) return toast("Piano associato a utenti"); const { error } = await db.from("plans").delete().eq("id", p.id); if (error) toast(error.message); else await refreshData(); };

function normalizeVideoUrl(url) {
  if (!url) return "";
  try { const u = new URL(url); if (u.hostname.includes("youtu.be")) return `https://www.youtube.com/embed/${u.pathname.replace("/", "")}`;
    if (u.hostname.includes("youtube.com")) { if (u.pathname.startsWith("/embed/")) return url; const v = u.searchParams.get("v"); if (v) return `https://www.youtube.com/embed/${v}`; const parts = u.pathname.split("/"), idx = parts.indexOf("shorts"); if (idx >= 0 && parts[idx + 1]) return `https://www.youtube.com/embed/${parts[idx + 1]}`; } return url;
  } catch { return url; }
}
function availableContents() { return state.contents.filter((c) => !c.archived && (!c.subscribers_only || sessionUser.plan !== "Trial")).sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); }
function renderFrontend() {
  const cats = orderedCategories(), mains = cats.filter((c) => !(c.parent_ids || []).length), html = [];
  mains.forEach((m) => { const children = cats.filter((c) => c.parent_ids?.includes(m.id)); html.push(`<div class="parent-row"><button id="front-cat-${m.id}" onclick="selectFrontCategory('${m.id}')">${esc(m.name)}</button>${children.length ? `<button class="expand-btn" onclick="toggleFrontChildren('${m.id}',event)">⌄</button>` : ""}</div>`); children.forEach((c) => html.push(`<button class="child-cat" data-parent="${m.id}" id="front-cat-${c.id}" onclick="selectFrontCategory('${c.id}')">↳ ${esc(c.name)}</button>`)); });
  $("frontCategories").innerHTML = html.join(""); renderUnread();
}
function frontCards(arr) { return `<div class="front-grid">${arr.map((c) => `<div class="content-card" onclick="openFrontContent('${c.id}')" style="cursor:pointer"><div class="thumb">${c.preview ? `<img src="${c.preview}" alt="">` : "Anteprima"}</div><div class="content-body"><h3>${esc(c.title)}</h3></div></div>`).join("")}</div>`; }
function showFrontHome() {
  activeFrontCategory = null; document.querySelectorAll(".front-side button").forEach((b) => b.classList.remove("active")); $("frontHomeBtn")?.classList.add("active");
  const arr = availableContents(), latest = arr[0], heroStyle = latest?.cover ? ` style="background:linear-gradient(90deg,rgba(4,8,6,.92),rgba(4,8,6,.25)),url('${latest.cover.replace(/'/g, "%27")}') center/cover no-repeat"` : "";
  $("frontMain").innerHTML = `<div class="hero"${heroStyle}>${latest ? `<div><span class="badge gold">In Evidenza</span><h1>${esc(latest.title)}</h1><p>${esc(latest.description || "")}</p><button class="btn" onclick="openFrontContent('${latest.id}')">GUARDA ORA</button></div>` : `<div><span class="badge gold">SERIE A CLASSIC</span><h1>Benvenuto ${esc(sessionUser.username)}</h1><p>Rivivi il calcio italiano della Golden Era.</p></div>`}</div><div class="section-head" style="margin-top:28px"><h2>Aggiunti di recente</h2></div>${arr.length ? frontCards(arr) : '<div class="empty">Nessun contenuto disponibile.</div>'}`;
}
window.showFrontHome = showFrontHome;
window.toggleFrontChildren = (id, e) => { e?.stopPropagation(); document.querySelectorAll(`.child-cat[data-parent="${id}"]`).forEach((el) => el.classList.toggle("visible")); };
window.selectFrontCategory = (id) => { activeFrontCategory = id; document.querySelectorAll(".front-side button").forEach((b) => b.classList.remove("active")); $(`front-cat-${id}`)?.classList.add("active"); showCategory(id); };
window.showCategory = (id) => { const cat = state.categories.find((c) => c.id === id), arr = availableContents().filter((c) => c.category_ids?.includes(id)); $("frontMain").innerHTML = `<div class="section-head"><div><h1>${esc(cat?.name || "Categoria")}</h1><div class="subtle">Contenuti ordinati dal più recente.</div></div></div>${arr.length ? frontCards(arr) : '<div class="empty">Nessun contenuto in questa categoria.</div>'}`; };
window.openFrontContent = (id) => { const c = availableContents().find((x) => x.id === id); if (!c) return; let safeUrl = normalizeVideoUrl(c.url); if (safeUrl.includes("youtube.com/embed/")) safeUrl = safeUrl.replace("youtube.com/embed/", "youtube-nocookie.com/embed/"); let embed = !safeUrl ? '<div class="empty">URL video non disponibile.</div>' : /\.mp4($|\?)/i.test(safeUrl) ? `<video src="${esc(safeUrl)}" controls playsinline></video>` : `<iframe src="${esc(safeUrl + (safeUrl.includes("?") ? "&" : "?") + "rel=0&modestbranding=1&iv_load_policy=3&playsinline=1")}" title="${esc(c.title)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`; $("frontMain").innerHTML = `<button class="icon-btn" onclick="showFrontHome()">← Indietro</button><div class="video-head"><h1>${esc(c.title)}</h1><p class="subtle">${esc(c.description || "")}</p></div><div class="video-view">${embed}</div>`; };

function messagesFor(userId) { return state.messages.filter((m) => m.user_id === userId).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)); }
function renderUnread() {
  if (sessionUser?.role === "admin") { const n = state.messages.filter((m) => m.recipient_role === "admin" && !m.read).length; $("adminUnread").textContent = n; $("adminUnread").classList.toggle("hidden", !n); }
  if (sessionUser?.role === "user") { const n = state.messages.filter((m) => m.user_id === sessionUser.id && m.recipient_role === "user" && !m.read).length; $("userUnread").textContent = n; $("userUnread").classList.toggle("hidden", !n); }
}
async function loadUserMessages() { const { data, error } = await db.from("messages").select("*").eq("user_id", sessionUser.id).order("created_at"); if (!error) state.messages = data || []; }
window.toggleAdminChat = () => { if (!state.users.length) return toast("Nessun utente disponibile"); currentChatUserId ||= state.users[0].id; openChat("admin", currentChatUserId); };
window.openAdminChatFor = (id) => { currentChatUserId = id; openChat("admin", id); };
window.toggleUserChat = async () => { await loadUserMessages(); openChat("user", sessionUser.id); };
async function openChat(role, userId) {
  const unread = messagesFor(userId).filter((m) => m.recipient_role === role && !m.read);
  if (unread.length) await db.from("messages").update({ read: true }).in("id", unread.map((m) => m.id));
  if (role === "admin") { const { data } = await db.from("messages").select("*").order("created_at"); state.messages = data || []; } else await loadUserMessages();
  const selector = role === "admin" ? `<select id="chatUserSelect">${state.users.map((u) => `<option value="${u.id}" ${u.id === userId ? "selected" : ""}>${esc(u.username)}</option>`).join("")}</select>` : "<b>Contatta Admin</b>";
  $("chatRoot").innerHTML = `<div class="chat-panel"><div class="chat-head">${selector}<button class="icon-btn" id="chatClose">✕</button></div><div id="chatBody" class="chat-body">${messagesFor(userId).map((m) => `<div class="bubble ${m.sender_id === sessionUser.id ? "me" : ""}">${esc(m.text)}<div class="subtle" style="font-size:11px;margin-top:5px">${new Date(m.created_at).toLocaleString("it-IT")}</div></div>`).join("") || '<div class="empty">Nessun messaggio.</div>'}</div><div class="chat-compose"><input id="chatInput" placeholder="Scrivi un messaggio..."><button class="btn" id="chatSend">Invia</button></div></div>`;
  $("chatClose").onclick = () => $("chatRoot").innerHTML = "";
  if (role === "admin") $("chatUserSelect").onchange = () => openChat("admin", $("chatUserSelect").value);
  $("chatSend").onclick = async () => { const text = $("chatInput").value.trim(); if (!text) return; const { error } = await db.from("messages").insert({ user_id: userId, sender_id: sessionUser.id, recipient_role: role === "admin" ? "user" : "admin", text }); if (error) return toast(error.message); openChat(role, userId); };
  renderUnread();
}

function exportData() {
  const data = { profiles: state.users, categories: state.categories, contents: state.contents, plans: state.plans, settings: state.settings, messages: state.messages };
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })); a.download = "serie-a-classic-backup.json"; a.click();
}

// Eventi
$("loginBtn").onclick = attemptLogin;
$("loginPass").addEventListener("keydown", (e) => e.key === "Enter" && attemptLogin());
$("mobileToggle").onclick = () => $("sidebar").classList.toggle("open");
document.querySelectorAll(".nav button[data-view]").forEach((b) => b.onclick = () => switchAdminView(b.dataset.view));
$("userSearch").oninput = renderUsers; $("userFilter").onchange = renderUsers;
$("addUserBtn").onclick = () => openUserModal();
$("addCategoryBtn").onclick = () => openCategoryModal();
$("addContentBtn").onclick = () => openContentModal();
$("saveAdminBtn").onclick = saveAdminProfile;
$("saveSystemBtn").onclick = saveSystem;
$("addPlanBtn").onclick = () => openPlanModal();
$("exportBtn").onclick = exportData;
$("importInput").onchange = () => toast("Per sicurezza l'importazione diretta nel database è disattivata. Usa SQL o uno script amministrativo.");
$("resetBtn").onclick = () => toast("L'azzeramento completo è disattivato per evitare cancellazioni accidentali.");
$("frontSearch").oninput = () => { const q = $("frontSearch").value.toLowerCase().trim(); if (!q) return showFrontHome(); const arr = availableContents().filter((c) => c.title.toLowerCase().includes(q)); $("frontMain").innerHTML = `<h1>Risultati ricerca</h1>${arr.length ? frontCards(arr) : '<div class="empty">Nessun risultato.</div>'}`; };

restoreSession();
