import cfg from './firebase-config.js';
const $ = (s, e = document) => e.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);

/* ---------- rayons (dans l'ordre d'un supermarché, modifiables dans les réglages) ---------- */
const DEF = [
  ['fruits', 'Fruits et légumes', '#3E9B3A', 'pomme,banane,orange,citron,tomate,salade,carotte,courgette,pomme de terre,oignon,ail,poire,fraise,raisin,avocat,concombre,poivron,champignon,legume,fruit,melon,pasteque,aubergine,haricot vert,persil,basilic,clementine,kiwi'],
  ['pain', 'Pain et pâtisserie', '#C98A2B', 'pain,baguette,brioche,croissant,viennoiserie,gateau,tarte,pain de mie'],
  ['viande', 'Boucherie et poisson', '#C2473B', 'viande,poulet,jambon,saucisse,steak,poisson,saumon,thon,crevette,lardon,dinde,boeuf,porc,merguez,veau,saucisson,charcuterie,cabillaud'],
  ['cremerie', 'Crèmerie', '#4A8FD4', 'lait,beurre,yaourt,fromage,oeuf,creme,emmental,mozzarella,gruyere,skyr,parmesan,chevre,fromage blanc'],
  ['epicerie', 'Épicerie', '#9A6B3E', 'pate,riz,farine,sucre,sel,huile,vinaigre,conserve,sauce,cafe,the,cereale,biscuit,chocolat,confiture,miel,lentille,chips,epice,moutarde,ketchup,mayonnaise,compote'],
  ['surgele', 'Surgelés', '#3BA6B5', 'surgele,glace,pizza,frite,nugget'],
  ['boissons', 'Boissons', '#7A5BC4', 'eau,jus,soda,biere,vin,cola,sirop,limonade,rose,champagne,pastis'],
  ['hygiene', 'Hygiène et beauté', '#D0589B', 'shampoing,savon,dentifrice,gel douche,deodorant,rasoir,coton,couche,papier toilette,mouchoir,brosse a dents,creme solaire'],
  ['menage', 'Ménage et entretien', '#D98A1F', 'lessive,liquide vaisselle,vaisselle,eponge,sac poubelle,javel,nettoyant,essuie-tout,adoucissant,papier alu,film aluminium,sopalin,lave-vaisselle,pastille,wc,detartrant'],
  ['autres', 'Autres', '#7B8580', '']
].map(([id, name, color, kw]) => ({ id, name, color, kw }));
let RAYONS = [];
function compile() {
  const l = (M.rayons && M.rayons.length ? M.rayons : DEF).map(r => ({ ...r }));
  if (!l.some(r => r.id === 'autres')) l.push({ ...DEF[DEF.length - 1] });
  RAYONS = l.map(r => ({ ...r, re: String(r.kw || '').split(',').map(w => norm(w)).filter(Boolean).map(w => new RegExp('(^|[^a-z])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/-/g, '[- ]'))) }));
}
const rayon = id => RAYONS.find(r => r.id === id) || RAYONS.find(r => r.id === 'autres');
const guess = name => { const n = norm(name); let best = 'autres', bs = 0; for (const r of RAYONS) { const s = r.re.filter(x => x.test(n)).length; if (s > bs) { best = r.id; bs = s; } } return best; };

/* ---------- état local ---------- */
const META = 'courses_meta';
const DEF_STORES = ['Carrefour', 'Leclerc', 'Lidl', 'Intermarché', 'Monoprix', 'Picard'];
let M = Object.assign({ fam: '', stores: DEF_STORES.slice(), storesTs: 0, habits: {}, relay: '', theme: 'auto', rayons: null, rayonsTs: 0 }, JSON.parse(localStorage.getItem(META) || '{}'));
compile();
let items = [];
const ikey = () => 'courses_items_' + (M.fam || 'local');
try { items = JSON.parse(localStorage.getItem(ikey()) || '[]'); } catch (e) { items = []; }
const applyTheme = () => { if (M.theme === 'light' || M.theme === 'dark') document.documentElement.dataset.theme = M.theme; else delete document.documentElement.dataset.theme; };
applyTheme();
let inst = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); inst = e; });
addEventListener('appinstalled', () => { inst = null; toast('Application installée.'); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const saveMeta = () => localStorage.setItem(META, JSON.stringify(M));
const saveItems = () => { try { localStorage.setItem(ikey(), JSON.stringify(items)); } catch (e) {} };
let storeFilter = 'all', pending = false;

/* ---------- synchro Firebase (facultative) ---------- */
let F = null, unsub = null;
const FIELDS = ['id', 'name', 'qty', 'cat', 'store', 'price', 'note', 'done', 'img', 'ts'];
const clean = it => Object.fromEntries(FIELDS.map(k => [k, it[k] ?? (k === 'price' ? null : k === 'qty' ? 1 : k === 'done' ? false : k === 'ts' ? Date.now() : '')]));
const ref = id => F.f.doc(F.db, 'lists', M.fam, 'items', id);
const safe = p => p && p.catch && p.catch(() => toast('Synchro impossible'));
async function initFb() {
  if (!cfg.apiKey) return;
  try {
    const base = 'https://www.gstatic.com/firebasejs/10.12.2/';
    const [a, f] = await Promise.all([import(base + 'firebase-app.js'), import(base + 'firebase-firestore.js')]);
    F = { f, db: f.initializeFirestore(a.initializeApp(cfg), { localCache: f.persistentLocalCache({ tabManager: f.persistentMultipleTabManager() }) }) };
  } catch (e) { F = null; }
}
let seed = [];
const metaDoc = n => F.f.doc(F.db, 'lists', M.fam, 'meta', n);
const pushMeta = (n, v, ts) => F && M.fam && safe(F.f.setDoc(metaDoc(n), { json: JSON.stringify(v), ts }));
const pushRayons = () => pushMeta('rayons', M.rayons, M.rayonsTs);
const pushStores = () => { if (!M.storesTs) { M.storesTs = Date.now(); saveMeta(); } pushMeta('stores', M.stores, M.storesTs); };
function startSync() {
  if (unsub) unsub(); unsub = null;
  if (!F || !M.fam) return status();
  const { f, db } = F;
  seed = items.slice();
  const u1 = f.onSnapshot(f.collection(db, 'lists', M.fam, 'items'), snap => {
    if (snap.empty && snap.metadata.fromCache) { status(); return; }
    if (snap.empty && seed.length) {
      for (let i = 0; i < seed.length; i += 400) { const b = f.writeBatch(db); seed.slice(i, i + 400).forEach(x => b.set(ref(x.id), clean(x))); safe(b.commit()); }
    } else items = snap.docs.map(d => d.data());
    seed = [];
    pending = snap.metadata.hasPendingWrites; saveItems(); render(); status();
  }, () => { $('#st').textContent = 'synchro impossible'; });
  const watch = (n, key, tsK, dirty, push) => f.onSnapshot(metaDoc(n), s => {
    const d = s.data();
    if (d && d.ts > (M[tsK] || 0)) { try { M[key] = JSON.parse(d.json); M[tsK] = d.ts; saveMeta(); if (key === 'rayons') compile(); render(); } catch (e) {} }
    else if (!s.exists() && !s.metadata.fromCache && dirty()) push();
  }, () => {});
  const u2 = watch('rayons', 'rayons', 'rayonsTs', () => !!M.rayons, pushRayons);
  const u3 = watch('stores', 'stores', 'storesTs', () => M.stores.join('|') !== DEF_STORES.join('|'), pushStores);
  unsub = () => { u1(); u2(); u3(); };
}
function saveStores(l) { M.stores = l; M.storesTs = Date.now(); saveMeta(); render(); pushStores(); }
const status = () => { $('#st').textContent = !M.fam ? 'sur cet appareil' : !navigator.onLine ? 'hors ligne' : pending ? 'synchro…' : 'synchronisé'; };
addEventListener('online', status); addEventListener('offline', status);

/* ---------- actions ---------- */
function put(it) {
  it.ts = Date.now();
  const k = items.findIndex(x => x.id === it.id);
  if (k < 0) items.push(it); else items[k] = it;
  saveItems(); render();
  if (F && M.fam) safe(F.f.setDoc(ref(it.id), clean(it)));
}
function drop(ids) {
  items = items.filter(x => !ids.includes(x.id)); saveItems(); render();
  if (F && M.fam) ids.forEach(id => safe(F.f.deleteDoc(ref(id))));
}
function addItem(text, extra = {}) {
  let name = text.trim(), qty = 1, m;
  if ((m = name.match(/^(\d+)\s*[x×]?\s+(.+)$/i))) { qty = +m[1]; name = m[2]; }
  else if ((m = name.match(/^(.+?)\s+[x×]\s*(\d+)$/i))) { name = m[1]; qty = +m[2]; }
  if (!name) return;
  const key = norm(name), dup = items.find(x => !x.done && norm(x.name) === key);
  if (dup) { dup.qty = (dup.qty || 1) + qty; put(dup); toast('Quantité augmentée : ' + dup.name); return; }
  const h = M.habits[key] || { n: name, c: 0, cat: guess(name + ' ' + (extra.hint || '')) };
  h.n = name; h.c++; M.habits[key] = h; saveMeta();
  put({ id: uid(), name, qty, cat: h.cat, store: '', price: null, note: '', done: false, img: extra.img || '', ...extra.fields });
}

/* ---------- interface ---------- */
const sheet = $('#sheet'), view = $('#view');
function toast(t) { $('#toast')?.remove(); const e = document.createElement('div'); e.id = 'toast'; e.textContent = t; (sheet.open ? sheet : document.body).appendChild(e); setTimeout(() => e.remove(), 2200); }
const open = html => { sheet.innerHTML = html; if (!sheet.open) sheet.showModal(); };
let stream = null;
sheet.addEventListener('close', () => { if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; } sheet.innerHTML = ''; });
sheet.addEventListener('click', e => {
  const r = sheet.getBoundingClientRect(), out = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  if ((e.target === sheet && out) || e.target.closest('[data-x]')) sheet.close();
});

function render() {
  const stores = M.stores;
  if (storeFilter !== 'all' && !stores.includes(storeFilter)) storeFilter = 'all';
  $('#chips').innerHTML = stores.length ? ['all', ...stores].map(s => `<button class="chip${storeFilter === s ? ' on' : ''}" data-s="${esc(s)}">${s === 'all' ? 'Tous les magasins' : esc(s)}</button>`).join('') : '';
  const vis = items.filter(i => storeFilter === 'all' || !i.store || i.store === storeFilter);
  const todo = vis.filter(i => !i.done), done = vis.filter(i => i.done);
  const est = todo.reduce((s, i) => s + (i.price || 0) * (i.qty || 1), 0);
  let h = `<p class="sum">${todo.length} à prendre${est ? ', estimation ' + eur(est) : ''}${done.length ? ', ' + done.length + ' dans le caddie' : ''}</p>`;
  if (!items.length) h = '<div class="empty">Votre liste est vide.<br>Tapez un article ci-dessus ou scannez un code-barres.</div>';
  for (const r of RAYONS) {
    const l = todo.filter(i => rayon(i.cat).id === r.id).sort((a, b) => a.name.localeCompare(b.name, 'fr'));
    if (l.length) h += `<div class="grp" style="--c:${r.color}"><i></i>${r.name}</div>` + l.map(row).join('');
  }
  if (done.length) h += `<div class="grp" style="--c:#2B7A4B"><i></i>Dans le caddie</div>` + done.map(row).join('') + '<button class="btn d" data-clear>Retirer les articles cochés</button>';
  view.innerHTML = h;
  sugs();
}
const row = i => `<div class="row${i.done ? ' done' : ''}" data-id="${i.id}" style="--c:${rayon(i.cat).color}">
  <button class="tick" data-tick aria-label="${i.done ? 'Remettre à acheter' : 'Mettre dans le caddie'} : ${esc(i.name)}"><svg viewBox="0 0 24 24"><path d="M5 12.5 10 17.5 19 7"/></svg></button>
  ${i.img ? `<img src="${esc(i.img)}" alt="" loading="lazy">` : ''}
  <button class="nm" data-edit><b>${esc(i.name)}</b>${i.store || i.note ? `<small>${esc([i.store, i.note].filter(Boolean).join(', '))}</small>` : ''}</button>
  <span class="qty">${(i.qty || 1) > 1 ? '× ' + i.qty : ''}</span></div>`;
view.onclick = e => {
  if (e.target.closest('[data-clear]')) { drop(items.filter(i => i.done).map(i => i.id)); return; }
  const r = e.target.closest('[data-id]'); if (!r) return;
  const it = items.find(x => x.id === r.dataset.id); if (!it) return;
  if (e.target.closest('[data-tick]')) put({ ...it, done: !it.done }); else edit(it);
};
$('#chips').onclick = e => { const b = e.target.closest('[data-s]'); if (b) { storeFilter = b.dataset.s; render(); } };

function sugs() {
  const v = norm($('#q').value), on = new Set(items.filter(i => !i.done).map(i => norm(i.name)));
  const l = Object.entries(M.habits).filter(([k]) => !on.has(k) && (!v || k.includes(v))).sort((a, b) => b[1].c - a[1].c).slice(0, v ? 6 : 8);
  $('#sug').innerHTML = l.map(([k, h]) => `<button data-h="${esc(k)}">+ ${esc(h.n)}</button>`).join('');
}
$('#sug').onclick = e => { const b = e.target.closest('[data-h]'); if (b) addItem(M.habits[b.dataset.h].n); };
$('#q').addEventListener('input', sugs);
$('#qa').onsubmit = e => { e.preventDefault(); const q = $('#q'); addItem(q.value); q.value = ''; };

const big = u => String(u).replace(/\.\d+\.jpg$/, '.400.jpg');
function edit(it) {
  open(`<h2>Modifier</h2>
  ${it.img ? `<img class="big" src="${esc(big(it.img))}" alt="Photo : ${esc(it.name)}">` : ''}
  <label>Article<input id="e-n" class="field" value="${esc(it.name)}"></label>
  <div class="two"><label>Quantité<input id="e-q" class="field" type="number" min="1" inputmode="numeric" value="${it.qty || 1}"></label>
  <label>Prix par unité (€)<input id="e-p" class="field" inputmode="decimal" value="${it.price != null ? String(it.price).replace('.', ',') : ''}"></label></div>
  <label>Rayon<select id="e-c">${RAYONS.map(r => `<option value="${r.id}"${r.id === rayon(it.cat).id ? ' selected' : ''}>${r.name}</option>`).join('')}</select></label>
  <label>Magasin<select id="e-s"><option value="">Peu importe</option>${[...M.stores, ...(it.store && !M.stores.includes(it.store) ? [it.store] : [])].map(s => `<option${s === it.store ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
  <label>Note (marque, taille…)<input id="e-o" class="field" value="${esc(it.note)}"></label>
  <button class="btn p" id="e-ok">Enregistrer</button><button class="btn d" id="e-rm">Supprimer</button><button class="btn" data-x>Annuler</button>`);
  const bi = $('.big', sheet); if (bi) bi.onerror = () => { bi.onerror = null; bi.src = it.img; };
  $('#e-ok', sheet).onclick = () => {
    const name = $('#e-n', sheet).value.trim(); if (!name) return toast('Indiquez le nom.');
    const p = parseFloat($('#e-p', sheet).value.replace(/\s/g, '').replace(',', '.'));
    const cat = $('#e-c', sheet).value; if (cat !== it.cat && M.habits[norm(it.name)]) { M.habits[norm(it.name)].cat = cat; saveMeta(); }
    put({ ...it, name, qty: Math.max(1, parseInt($('#e-q', sheet).value, 10) || 1), price: isNaN(p) ? null : p, cat, store: $('#e-s', sheet).value, note: $('#e-o', sheet).value.trim() });
    sheet.close();
  };
  $('#e-rm', sheet).onclick = () => { drop([it.id]); sheet.close(); };
}

/* ---------- code-barres : détection caméra + fiche produit ---------- */
async function lookup(ean) {
  const base = M.relay.replace(/\/+$/, '');
  if (base) return (await fetch(base + '/?ean=' + ean)).json();
  const j = await (await fetch(`https://world.openfoodfacts.org/api/v2/product/${ean}.json?fields=product_name,product_name_fr,brands,quantity,image_front_small_url`)).json();
  const p = j.product; return p ? { ok: 1, name: p.product_name_fr || p.product_name, brand: (p.brands || '').split(',')[0], quantity: p.quantity, image: p.image_front_small_url } : { ok: 0 };
}
async function fromEan(ean) {
  toast('Recherche du produit…');
  try {
    const p = await lookup(ean);
    if (!p.ok || !p.name) return toast('Produit inconnu : tapez son nom.');
    addItem(p.name, { img: p.image || '', hint: p.brand, fields: { note: [p.brand, p.quantity].filter(Boolean).join(', ') } });
  } catch (e) { toast('Recherche impossible (réseau ?).'); }
}
$('#scan').onclick = async () => {
  if (!('BarcodeDetector' in window) || !navigator.mediaDevices) { const e = (prompt('Numéro du code-barres (EAN) :') || '').replace(/\D/g, ''); if (e) fromEan(e); return; }
  open('<h2>Scanner un produit</h2><video id="v" playsinline muted></video><p class="hint">Visez le code-barres : le produit s’ajoute tout seul.</p><button class="btn" data-x>Fermer</button>');
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    const v = $('#v', sheet); v.srcObject = stream; await v.play();
    const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a'] });
    const loop = async () => {
      if (!stream) return;
      try { const r = await det.detect(v); if (r[0]) { sheet.close(); return fromEan(r[0].rawValue); } } catch (e) {}
      setTimeout(loop, 250);
    };
    loop();
  } catch (e) { sheet.close(); toast('Caméra refusée ou indisponible.'); }
};

/* ---------- gestion des rayons ---------- */
const cur = () => (M.rayons && M.rayons.length ? M.rayons : DEF).map(r => ({ id: r.id, name: r.name, color: r.color, kw: r.kw }));
function saveRayons(l) { M.rayons = l; M.rayonsTs = Date.now(); saveMeta(); compile(); render(); pushRayons(); }
function manageRayons() {
  const l = cur();
  open('<h2>Rayons</h2><p class="hint">L’ordre ci-dessous est l’ordre d’affichage dans la liste.</p>' + l.map((r, i) => `<div class="row"><i class="dot" style="background:${esc(r.color)}"></i><button class="nm" data-e="${i}"><b>${esc(r.name)}</b></button><button class="mv" data-u="${i}" aria-label="Monter ${esc(r.name)}"${i ? '' : ' disabled'}>↑</button><button class="mv" data-d="${i}" aria-label="Descendre ${esc(r.name)}"${i < l.length - 1 ? '' : ' disabled'}>↓</button></div>`).join('') +
    '<button class="btn p" id="y-add">Ajouter un rayon</button><button class="btn" id="y-rs">Rétablir les rayons par défaut</button><button class="btn" id="y-bk">Retour aux réglages</button>');
  const mv = (i, j) => { [l[i], l[j]] = [l[j], l[i]]; saveRayons(l); manageRayons(); };
  sheet.querySelectorAll('[data-e]').forEach(b => b.onclick = () => editRayon(+b.dataset.e));
  sheet.querySelectorAll('[data-u]').forEach(b => b.onclick = () => mv(+b.dataset.u, +b.dataset.u - 1));
  sheet.querySelectorAll('[data-d]').forEach(b => b.onclick = () => mv(+b.dataset.d, +b.dataset.d + 1));
  $('#y-add', sheet).onclick = () => editRayon(-1);
  $('#y-rs', sheet).onclick = () => { if (confirm('Rétablir les rayons par défaut ? Vos rayons personnalisés seront perdus.')) { saveRayons(DEF.map(r => ({ ...r }))); manageRayons(); } };
  $('#y-bk', sheet).onclick = () => $('#menu').onclick();
}
function editRayon(i) {
  const l = cur(), r = i >= 0 ? l[i] : { id: 'r' + uid(), name: '', color: '#3E9B3A', kw: '' };
  open(`<h2>${i >= 0 ? 'Modifier le rayon' : 'Nouveau rayon'}</h2>
  <label>Nom<input id="y-n" class="field" value="${esc(r.name)}"></label>
  <label>Couleur<input id="y-c" type="color" class="field" value="${esc(r.color)}" style="height:48px;padding:4px"></label>
  <label>Mots-clés pour classer automatiquement (séparés par des virgules)<textarea id="y-k" rows="3">${esc(r.kw)}</textarea></label>
  <button class="btn p" id="y-ok">Enregistrer</button>${i >= 0 && r.id !== 'autres' ? '<button class="btn d" id="y-rm">Supprimer</button>' : ''}<button class="btn" id="y-bk">Annuler</button>`);
  $('#y-bk', sheet).onclick = manageRayons;
  $('#y-ok', sheet).onclick = () => {
    const name = $('#y-n', sheet).value.trim(); if (!name) return toast('Indiquez le nom du rayon.');
    Object.assign(r, { name, color: $('#y-c', sheet).value, kw: $('#y-k', sheet).value.trim() });
    if (i >= 0) l[i] = r; else { const k = l.findIndex(x => x.id === 'autres'); if (k < 0) l.push(r); else l.splice(k, 0, r); }
    saveRayons(l); manageRayons();
  };
  if ($('#y-rm', sheet)) $('#y-rm', sheet).onclick = () => { if (confirm('Supprimer ce rayon ? Ses articles passeront dans « Autres ».')) { l.splice(i, 1); saveRayons(l); manageRayons(); } };
}

/* ---------- partage et réglages ---------- */
function listText() {
  const L = [`Liste de courses du ${new Date().toLocaleDateString('fr-FR')}`];
  for (const r of RAYONS) { const l = items.filter(i => !i.done && rayon(i.cat).id === r.id); if (l.length) { L.push('', r.name); l.forEach(i => L.push(`- ${i.name}${(i.qty || 1) > 1 ? ' × ' + i.qty : ''}${i.note ? ' (' + i.note + ')' : ''}`)); } }
  return L.join('\n');
}
$('#share').onclick = async () => {
  if (!items.some(i => !i.done)) return toast('Rien à acheter.');
  if (navigator.share) navigator.share({ title: 'Liste de courses', text: listText() }).catch(() => {});
  else { await navigator.clipboard.writeText(listText()).catch(() => {}); toast('Liste copiée.'); }
};
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(10)), x => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
function join(code) {
  M.fam = code; saveMeta();
  try { items = JSON.parse(localStorage.getItem(ikey()) || 'null') || items; } catch (e) {}
  saveItems(); startSync(); render();
}
$('#menu').onclick = () => {
  open(`<h2>Réglages</h2>
  ${standalone() ? '<p class="hint">Application installée sur cet appareil.</p>' : '<button class="btn p" id="r-inst">Installer l’application</button>'}
  <label>Apparence</label><select id="r-th"><option value="auto">Automatique (réglage du téléphone)</option><option value="light">Clair</option><option value="dark">Sombre</option></select>
  <label>Liste partagée (code foyer)</label>
  ${M.fam ? `<p><b style="font:800 1.3rem ui-monospace,monospace;letter-spacing:2px">${M.fam}</b></p><button class="btn" id="r-cp">Copier le lien d’invitation</button><button class="btn d" id="r-qt">Quitter la liste partagée</button>`
    : `${F ? '<button class="btn p" id="r-new">Créer une liste partagée</button><input id="r-code" class="field" placeholder="Ou saisir un code reçu (8 à 20 caractères)" style="margin-top:10px"><button class="btn" id="r-join">Rejoindre</button>' : '<p class="hint">Synchro indisponible (voir firebase-config.js ou connexion).</p>'}`}
  <button class="btn" id="r-ray">Gérer les rayons</button>
  <label>Magasins (séparés par des virgules)</label><input id="r-st" class="field" value="${esc(M.stores.join(', '))}">
  <label>Relais Cloudflare (facultatif, recherche par code-barres)</label><input id="r-rl" class="field" inputmode="url" autocapitalize="off" placeholder="https://courses-relais.xxx.workers.dev" value="${esc(M.relay)}">
  <p class="hint" id="r-msg" role="status"></p>
  <button class="btn p" id="r-ok">Enregistrer</button><button class="btn" data-x>Fermer</button>`);
  const s = id => $(id, sheet);
  s('#r-ray').onclick = manageRayons;
  s('#r-th').value = M.theme || 'auto';
  s('#r-th').onchange = e => { M.theme = e.target.value; saveMeta(); applyTheme(); };
  if (s('#r-inst')) s('#r-inst').onclick = async () => {
    if (inst) { inst.prompt(); try { await inst.userChoice; } catch (e) {} inst = null; return; }
    s('#r-msg').textContent = 'Chrome ne propose pas encore l’installation automatique. Ouvrez le menu ⋮ du navigateur, puis « Installer l’application » (ou « Ajouter à l’écran d’accueil »). L’adresse doit commencer par https://.';
  };
  if (s('#r-new')) s('#r-new').onclick = () => { join(genCode()); sheet.close(); toast('Liste partagée créée.'); $('#menu').click(); };
  if (s('#r-join')) s('#r-join').onclick = () => { const c = s('#r-code').value.toUpperCase().replace(/[^A-Z0-9]/g, ''); if (c.length < 8) return toast('Le code a au moins 8 caractères.'); join(c); sheet.close(); };
  if (s('#r-cp')) s('#r-cp').onclick = () => navigator.clipboard.writeText(location.origin + location.pathname + '#f=' + M.fam).then(() => toast('Lien copié.'));
  if (s('#r-qt')) s('#r-qt').onclick = () => { if (confirm('Quitter la liste partagée ? Les données restent sur cet appareil.')) { if (unsub) unsub(); unsub = null; M.fam = ''; saveMeta(); saveItems(); status(); render(); sheet.close(); } };
  s('#r-ok').onclick = async () => {
    const ns = s('#r-st').value.split(',').map(x => x.trim()).filter(Boolean);
    if (ns.join('|') !== M.stores.join('|')) saveStores(ns);
    M.relay = s('#r-rl').value.trim(); if (M.relay && !/^https?:/i.test(M.relay)) M.relay = 'https://' + M.relay;
    saveMeta();
    if (M.relay) { try { const r = await (await fetch(M.relay.replace(/\/+$/, '') + '/?ping=1')).json(); if (!r.pong) throw 0; } catch (e) { s('#r-msg').textContent = 'Le relais ne répond pas : l’app interroge Open Food Facts directement.'; render(); return; } }
    render(); sheet.close(); toast('Réglages enregistrés.');
  };
};

/* ---------- démarrage ---------- */
(async () => {
  const m = location.hash.match(/f=([A-Za-z0-9]{8,20})/);
  render(); status();
  await initFb();
  if (m) { history.replaceState(null, '', location.pathname); join(m[1].toUpperCase()); }
  else startSync();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
})();
