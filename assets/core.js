/* BantAI v2 — shared helpers: data, reviewer key, header, formatting. */
const B = (() => {
  const KEY = 'bantai-reviewer-key';
  let pub = null, priv = null;

  const b64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
  async function decrypt(enc, pass) {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: b64(enc.salt), iterations: enc.rounds },
      base, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
    const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(enc.iv) }, key, b64(enc.data));
    return JSON.parse(new TextDecoder().decode(out));
  }
  async function publicData() {
    if (!pub) pub = await (await fetch('data/public.json', { cache: 'no-cache' })).json();
    return pub;
  }
  async function reviewerData(pass) {
    pass = pass || sessionStorage.getItem(KEY);
    if (!pass) return null;
    if (priv) return priv;
    const enc = await (await fetch('data/reviewer.enc.json', { cache: 'no-cache' })).json();
    try { priv = await decrypt(enc, pass.trim()); sessionStorage.setItem(KEY, pass.trim()); return priv; }
    catch (e) { sessionStorage.removeItem(KEY); return null; }
  }
  // A reviewer-only file, opened in the browser with the key already entered.
  async function openEnc(url) {
    const pass = sessionStorage.getItem(KEY);
    if (!pass) return null;
    return decrypt(await (await fetch(url, { cache: 'no-cache' })).json(), pass.trim());
  }
  /* Team review decisions. Sent encrypted through the relay, so every reviewer sees them within minutes; an hourly job
     then saves them in the private repository (site_v2/decision_intake.py) and they come back in the reviewer bundle.
     The topic and the key come from the team key, so only people with that key can read or write them. */
  const LOCAL = 'bantai-decisions';
  const readLocal = () => { try { return JSON.parse(localStorage.getItem(LOCAL)) || {}; } catch (e) { return {}; } };
  const writeLocal = v => { try { localStorage.setItem(LOCAL, JSON.stringify(v)); } catch (e) { /* the relay still has it */ } };
  let rel = null;
  async function relayKey() {
    if (rel) return rel;
    const pass = sessionStorage.getItem(KEY); if (!pass) return null;
    const te = new TextEncoder(), raw = te.encode(pass.trim());
    const hex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode('bantai-decisions-topic|' + pass.trim())))].map(x => x.toString(16).padStart(2, '0')).join('');
    const base = await crypto.subtle.importKey('raw', raw, 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: te.encode('bantai-decisions-v1'), iterations: 250000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return (rel = { key, topic: 'bantai-dec-' + hex.slice(0, 24) });
  }
  const toB64 = u => { let s = ''; const b = new Uint8Array(u); for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); };
  async function sendReview(rec) {
    const r = await relayKey(); if (!r) return false;
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, r.key, new TextEncoder().encode(JSON.stringify(rec)));
    try { return (await fetch('https://ntfy.sh/' + r.topic, { method: 'POST', body: JSON.stringify({ v: 1, iv: toB64(iv), ct: toB64(ct) }) })).ok; } catch (e) { return false; }
  }
  async function pollReviews() {
    const r = await relayKey(), out = []; if (!r) return out;
    let lines = [];
    try { lines = (await (await fetch(`https://ntfy.sh/${r.topic}/json?poll=1&since=12h`)).text()).split('\n'); } catch (e) { return out; }
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const m = JSON.parse(line);
        const body = m.attachment && m.attachment.url ? await (await fetch(m.attachment.url)).text() : m.message;
        const env = JSON.parse(body);
        const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, r.key, b64(env.ct));
        out.push(JSON.parse(new TextDecoder().decode(pt)));
      } catch (e) { /* not ours, or expired */ }
    }
    return out;
  }
  // Latest decision per contract across the team. A decision saved here that has not reached the team yet is sent again.
  async function reviews() {
    const d = await reviewerData(); if (!d) return {};
    const out = { ...(d.reviews || {}) };
    const take = x => { if (x && x.id && String(x.at || '') >= String((out[x.id] || {}).at || '')) out[x.id] = x; };
    const relayed = await pollReviews(); relayed.forEach(take);
    const local = readLocal();
    for (const [id, x] of Object.entries(local)) {
      if (String(x.at || '') > String((out[id] || {}).at || '')) { const rec = { ...x, id }; out[id] = rec; sendReview(rec); }
    }
    writeLocal(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v])));
    return out;
  }
  async function saveReview(id, rec) {
    const full = { ...rec, id, at: rec.at || new Date().toISOString() };
    const local = readLocal(); local[id] = full; writeLocal(local);
    return sendReview(full);
  }
  const isReviewer = () => !!sessionStorage.getItem(KEY);
  function signOut() { sessionStorage.removeItem(KEY); location.href = 'index.html'; }

  async function allContracts() {
    const p = await publicData();
    const r = await reviewerData();
    const extra = (r && r.a_extra) || {};   // reviewer-only detail on public contracts (Affiliation leads)
    const pubList = p.contracts.map(c => extra[c.id] ? { ...c, ...extra[c.id] } : c);
    return { list: r ? pubList.concat(r.contracts) : p.contracts.slice(), reviewer: !!r,
             analyses: (r && r.analyses) || {}, relay: (r && r.relay) || '', reports: (r && r.reports) || [] };
  }

  const logo = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v3M8 6.5v3M8 12v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function header(active) {
    const el = document.getElementById('top');
    const rev = isReviewer();
    const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
    el.className = 'top';
    el.innerHTML = `<div class="wrap"><div class="left">
      <a class="brand" href="index.html"><i>${logo}</i>BantAI</a>
      <nav class="nav">${link('queue.html', rev ? 'Queue' : 'Official records', 'queue')}${link('method.html', 'How it works', 'method')}${link('ledger.html', 'Ledger', 'ledger')}</nav></div>
      <div class="right"><span class="num" id="weekLabel"></span>
      ${rev ? '<button class="who" id="signout" title="Sign out"><span class="dot"></span>Reviewer · sign out</button>' : '<a class="who" href="signin.html">Reviewer sign-in</a>'}
      </div></div>`;
    const so = document.getElementById('signout');
    if (so) so.onclick = signOut;
    publicData().then(p => { const w = document.getElementById('weekLabel'); if (w) w.textContent = 'List of ' + date(p.snapshot); });
  }

  const nf = new Intl.NumberFormat('en-US');
  const n = x => x == null ? '—' : nf.format(x);
  function peso(x, unit) {
    if (x == null) return '—';
    if (unit === 'M' || (!unit && x < 1e9)) return '₱' + (x / 1e6).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' M';
    if (unit === 'tn' || (!unit && x >= 1e12)) return '₱' + (x / 1e12).toFixed(2) + ' tn';
    return '₱' + (x / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' bn';
  }
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function date(s) { if (!s) return '—'; const [y, m, d] = s.slice(0, 10).split('-'); return `${+d} ${MON[+m - 1]} ${y}`; }
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tierName = { A: 'Official record', B: 'Rule triggered', C: 'Risk signals' };

  return { publicData, reviewerData, openEnc, reviews, saveReview, allContracts, isReviewer, header, n, peso, date, esc, tierName, signOut };
})();
