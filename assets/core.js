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
  const isReviewer = () => !!sessionStorage.getItem(KEY);
  function signOut() { sessionStorage.removeItem(KEY); location.href = 'index.html'; }

  async function allContracts() {
    const p = await publicData();
    const r = await reviewerData();
    return { list: r ? p.contracts.concat(r.contracts) : p.contracts.slice(), reviewer: !!r };
  }

  const logo = '<svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1v3M8 6.5v3M8 12v3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  function header(active, opts = {}) {
    const el = document.getElementById('top');
    const rev = isReviewer();
    const link = (href, label, key) => `<a href="${href}" class="${active === key ? 'on' : ''}">${label}</a>`;
    if (opts.light) {
      el.className = 'top light';
      el.innerHTML = `<div class="wrap" style="padding-top:12px;padding-bottom:12px">
        <a class="brand" href="index.html"><i style="color:#F6F5F1">${logo}</i>BantAI</a>
        <nav class="nav"><a href="#how">How it works</a><a href="ledger.html">Weekly ledger</a><a href="queue.html">Official records</a>
        ${rev ? '<a class="pill" href="queue.html">Open the queue</a>' : '<a class="pill" href="signin.html">Reviewer sign-in</a>'}</nav></div>`;
      return;
    }
    el.className = 'top';
    el.innerHTML = `<div class="wrap"><div style="display:flex;align-items:center;gap:36px;flex-wrap:wrap">
      <a class="brand" href="index.html"><i style="color:#1B1A17">${logo}</i>BantAI</a>
      <nav class="nav">${link('queue.html', rev ? 'Queue' : 'Official records', 'queue')}${link('ledger.html', 'Ledger', 'ledger')}</nav></div>
      <div style="display:flex;align-items:center;gap:14px;font-size:13px;color:#B9B4A8">
      <span class="num" id="weekLabel"></span>
      ${rev ? '<button class="who" id="signout" title="Sign out"><span class="dot"></span>Reviewer</button>' : '<a class="who" href="signin.html" style="text-decoration:none">Reviewer sign-in</a>'}
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
  const tierName = { A: 'Official record', B: 'Rule broken', C: 'Several signals' };

  return { publicData, reviewerData, allContracts, isReviewer, header, n, peso, date, esc, tierName, signOut };
})();
