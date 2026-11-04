/* BantAI v2 — public report pop-up. A report is a request to check and never changes a flag.
   The message, contact details and files are encrypted in the visitor's browser with the team's public key, then
   sent in small parts through the ntfy.sh relay. The hourly job site_v2/report_intake.py opens them in the private
   repository. Nothing is sent or kept in clear. See docs/REPORTS.md. */
const BReport = (() => {
  const esc = s => B.esc(s);
  const MAX_FILES = 5, MAX_MB = 10, CHUNK = 1000000;
  const ACCEPT = 'image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.txt';
  const OK_TYPE = /\.(jpe?g|png|heic|heif|gif|webp|tiff?|bmp|mp4|mov|m4v|avi|webm|mkv|3gp|pdf|docx?|xlsx?|txt)$/i;
  const CATS = () => [
    { g: 'A', name: B.tierName.A, side: 'Public documents', col: 'var(--a)', items: [
      ['Contract named in an official record', 'COA audit finding, DPWH or agency action, Sandiganbayan case'],
      ["Contractor's licence revoked or suspended", 'PCAB revocation or suspension, incl. joint-venture partners'],
      ['Licence marked [REVOKED] in DPWH records', ''],
      ['Contractor on a development-bank debarment list', 'ADB, World Bank or IDB']] },
    { g: 'B', name: B.tierName.B, side: 'Written rules', col: 'var(--b)', items: [
      ['Award above the approved budget', 'RA 9184, Sec. 31 ceiling'],
      ['Contract larger than the licence allows', "Above the PCAB category's allowable range"],
      ['Completed in under a quarter of the contract time', '']] },
    { g: 'C', name: B.tierName.C, side: 'Risk families', col: 'var(--c)', items: [
      ['Tender', 'Single bidder near budget, very low award, or rushed award'],
      ['Price', 'Cost per km unusually high for the year and region'],
      ['Contractor record', 'Terminations, delays or past citizen reports'],
      ['Concentration', "One contractor dominates an office's contracts"],
      ['Site and package', 'Same site funded again, split contracts, duplicate entries'],
      ['Delivery', 'Visible slippage, stalled or poor-quality work on site']] }
  ];
  const OTHER = 'Other / not sure';
  const b64 = u => { let s = ''; const b = new Uint8Array(u); for (let i = 0; i < b.length; i += 32768) s += String.fromCharCode(...b.subarray(i, i + 32768)); return btoa(s); };
  const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

  async function post(topic, env, tries = 3) {
    for (let i = 0; i < tries; i++) {
      try {
        const r = await fetch(`https://ntfy.sh/${topic}?filename=part.json`, { method: 'POST', body: new Blob([JSON.stringify(env)], { type: 'text/plain' }) });
        if (r.ok) return;
      } catch (e) { /* retried below */ }
      await new Promise(ok => setTimeout(ok, 1500 * (i + 1)));
    }
    throw new Error('send');
  }

  async function send(cfg, meta, files, progress) {
    const pub = await crypto.subtle.importKey('spki', unb64(cfg.spki), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['wrapKey']);
    const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const wrapped = b64(await crypto.subtle.wrapKey('raw', key, pub, { name: 'RSA-OAEP' }));
    const seal = async bytes => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes)) }; };
    const rid = [...crypto.getRandomValues(new Uint8Array(6))].map(x => x.toString(16).padStart(2, '0')).join('');
    const total = files.reduce((a, f) => a + Math.max(1, Math.ceil(f.size / CHUNK)), 0) + 1;
    let done = 0;
    const list = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i], n = Math.max(1, Math.ceil(f.size / CHUNK));
      list.push({ name: f.name, type: f.type, size: f.size, chunks: n });
      for (let c = 0; c < n; c++) {
        const bytes = await f.slice(c * CHUNK, (c + 1) * CHUNK).arrayBuffer();
        await post(cfg.topic, { v: 1, kind: 'chunk', rid, file: i, seq: c, wrapped, ...(await seal(bytes)) });
        progress(++done, total);
      }
    }
    // The summary goes last, so the intake job knows every part was sent before it arrives.
    const body = new TextEncoder().encode(JSON.stringify({ ...meta, at: new Date().toISOString(), files: list }));
    await post(cfg.topic, { v: 1, kind: 'meta', rid, wrapped, ...(await seal(body)) });
    progress(++done, total);
    return rid;
  }

  function open(contract) {
    document.getElementById('rpOv')?.remove();
    const last = document.activeElement;
    const ov = document.createElement('div');
    ov.className = 'rp-ov'; ov.id = 'rpOv';
    ov.innerHTML = `<div class="rp" role="dialog" aria-modal="true" aria-labelledby="rpTitle">
      <div class="rp-top"><span>BantAI</span><button type="button" id="rpX" aria-label="Close">×</button></div>
      <form id="rpForm" novalidate style="display:flex;flex-direction:column;min-height:0;flex:1">
      <div class="rp-body">
        <div class="kicker" style="margin:0">Third-party monitoring · I-Report</div>
        <h2 id="rpTitle">Report what you see on a public works site</h2>
        <p class="small" style="margin:0;line-height:1.5">Citizens, journalists and civil-society monitors can send what they observe. Each report is read by the review team.</p>
        <p class="rp-note">A report is a request to check. It is never a finding, and it never says that anyone did wrong.</p>
        <span class="h" id="rpCatL">Category <em>*</em> <small>which flag does this relate to?</small></span>
        <button type="button" class="rp-sel" id="rpCat" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="rpCatL rpCat"><span id="rpCatV" class="muted">Please select</span><span aria-hidden="true">▾</span></button>
        <ul class="rp-list" id="rpList" role="listbox" aria-labelledby="rpCatL" hidden></ul>
        <label class="h" for="rpWhere">Contract ID or project location <small>(optional)</small></label>
        <input type="text" id="rpWhere" maxlength="200" placeholder="e.g. contract ID, barangay or road name" value="${esc(contract || '')}">
        <div class="rp-3">
          <div><label class="h" for="rpName">Name <small>(optional)</small></label><input type="text" id="rpName" maxlength="100" placeholder="Your name" autocomplete="name"></div>
          <div><label class="h" for="rpMail">Email <small>(optional)</small></label><input type="email" id="rpMail" maxlength="150" placeholder="name@email.com" autocomplete="email"></div>
          <div><label class="h" for="rpTel">Contact no. <small>(optional)</small></label><input type="tel" id="rpTel" maxlength="30" placeholder="+63" autocomplete="tel"></div>
        </div>
        <label class="h" for="rpMsg">Message <em>*</em></label>
        <textarea id="rpMsg" rows="4" maxlength="5000" placeholder="What did you see, where and when?"></textarea>
        <p class="tiny muted" style="margin:6px 0 0">Please describe the work, not people. Do not name private individuals. Do not enter a work site to take photos.</p>
        <label class="rp-drop" id="rpDrop"><b>Drop files here or click to upload</b><br><span class="tiny muted">Photo, video or document (optional) · Maximum ${MAX_FILES} files, ${MAX_MB} MB each</span><input type="file" id="rpFile" multiple accept="${ACCEPT}" hidden></label>
        <ul class="rp-files" id="rpFiles"></ul>
        <div class="rp-hp" aria-hidden="true"><label>Website<input type="text" id="rpSite" tabindex="-1" autocomplete="off"></label></div>
        <p class="tiny muted" style="margin:12px 0 4px;line-height:1.5">Name and contact details are optional and never published. Your report is encrypted on this device and passes through a third-party relay (ntfy.sh) that cannot read it. Only the review team can open it, and they may contact you if you leave details. A report does not change a flag.</p>
        <div class="err" id="rpErr" role="alert"></div>
      </div>
      <div class="rp-foot"><button type="button" class="btn" id="rpCancel">Cancel</button><button type="submit" class="btn rp-send" id="rpSend">Submit report →</button></div>
      </form></div>`;
    document.body.appendChild(ov); document.body.classList.add('rp-open');
    const $ = id => document.getElementById(id);
    const close = () => { ov.remove(); document.body.classList.remove('rp-open'); document.removeEventListener('keydown', onKey); if (last && last.isConnected) last.focus(); };
    const onKey = e => { if (e.key === 'Escape') { if (!$('rpList') || $('rpList').hidden) close(); else toggle(false); } };
    document.addEventListener('keydown', onKey);
    $('rpX').onclick = close; $('rpCancel').onclick = close;
    ov.addEventListener('mousedown', e => { if (e.target === ov) close(); });

    /* category list */
    let category = '', active = -1;
    const list = $('rpList');
    list.innerHTML = CATS().map(g => `<li role="presentation" class="rp-g"><span><i style="background:${g.col}"></i>${g.g} · ${esc(g.name)}</span><span>${esc(g.side)}</span></li>` +
      g.items.map(([t, d]) => `<li role="option" class="rp-o" aria-selected="false" data-v="${esc(g.g + ' · ' + t)}" data-l="${esc(t)}">${esc(t)}${d ? `<small>${esc(d)}</small>` : ''}</li>`).join('')).join('') +
      `<li role="option" class="rp-o" style="padding-left:12px;margin-top:6px;border-top:1px solid var(--line2);padding-top:10px" aria-selected="false" data-v="${OTHER}" data-l="${OTHER}">${OTHER}</li>`;
    const opts = [...list.querySelectorAll('[role=option]')];
    function toggle(show) { list.hidden = !show; $('rpCat').setAttribute('aria-expanded', String(show)); if (show) { active = Math.max(0, opts.findIndex(o => o.dataset.v === category)); flag(); } else $('rpCat').focus(); }
    function flag() { opts.forEach((o, i) => o.classList.toggle('act', i === active)); opts[active]?.scrollIntoView({ block: 'nearest' }); }
    function choose(o) { category = o.dataset.v; opts.forEach(x => x.setAttribute('aria-selected', String(x === o))); $('rpCatV').textContent = o.dataset.l; $('rpCatV').classList.remove('muted'); toggle(false); }
    $('rpCat').onclick = () => toggle(list.hidden);
    list.onclick = e => { const o = e.target.closest('[role=option]'); if (o) choose(o); };
    $('rpCat').onkeydown = e => {
      if (list.hidden) { if (e.key === 'ArrowDown') { e.preventDefault(); toggle(true); } return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(opts.length - 1, active + 1); flag(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(0, active - 1); flag(); }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(opts[active]); }
    };

    /* files */
    const files = [], err = $('rpErr');
    const showFiles = () => {
      $('rpFiles').innerHTML = files.map((f, i) => `<li><span style="overflow-wrap:anywhere">${esc(f.name)} <span class="muted">${(f.size / 1048576).toFixed(1)} MB</span></span><button type="button" class="cl-x" data-i="${i}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join('');
    };
    const add = list2 => {
      err.textContent = '';
      for (const f of list2) {
        if (files.length >= MAX_FILES) { err.textContent = `You can send up to ${MAX_FILES} files.`; break; }
        if (f.size > MAX_MB * 1048576) { err.textContent = `${f.name} is over ${MAX_MB} MB.`; continue; }
        if (!OK_TYPE.test(f.name)) { err.textContent = `${f.name}: please send a photo, video, PDF, Word, Excel or text file.`; continue; }
        files.push(f);
      }
      showFiles();
    };
    $('rpFile').onchange = e => { add([...e.target.files]); e.target.value = ''; };
    $('rpFiles').onclick = e => { if (e.target.dataset.i !== undefined) { files.splice(+e.target.dataset.i, 1); showFiles(); } };
    const drop = $('rpDrop');
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
    drop.ondragleave = () => drop.classList.remove('over');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); add([...e.dataTransfer.files]); };

    /* send */
    $('rpForm').onsubmit = async e => {
      e.preventDefault(); err.textContent = '';
      const message = $('rpMsg').value.trim(), mail = $('rpMail').value.trim();
      if (!category) { err.textContent = 'Please choose a category. "Other / not sure" is fine.'; $('rpCat').focus(); return; }
      if (!message) { err.textContent = 'Please write what you saw.'; $('rpMsg').focus(); return; }
      if (mail && !/^\S+@\S+\.\S+$/.test(mail)) { err.textContent = 'Please check the email, or leave it empty.'; $('rpMail').focus(); return; }
      const thanks = rid => {
        ov.querySelector('form').innerHTML = `<div class="rp-body" style="padding-bottom:22px"><h2 tabindex="-1" id="rpDone">Thank you. Your report was sent.</h2><p style="line-height:1.55">Your reference is <b class="num">${esc(rid)}</b>. The review team reads reports in batches, so it may take some time. A report is a request to check; it does not change a flag.</p><button type="button" class="btn dark" id="rpEnd">Close</button></div>`;
        $('rpEnd').onclick = close; $('rpDone').focus();
      };
      if ($('rpSite').value) { thanks('received'); return; }   // filled only by automated bots
      const send1 = $('rpSend'); send1.disabled = true; $('rpCancel').disabled = true;
      try {
        const p = await B.publicData();
        if (!p.report || !p.report.topic || !window.crypto || !crypto.subtle) throw new Error('off');
        const rid = await send(p.report, { category, where: $('rpWhere').value.trim(), name: $('rpName').value.trim(), email: mail, phone: $('rpTel').value.trim(), message }, files,
          (d, t) => { send1.textContent = `Sending ${d} of ${t}…`; });
        thanks(rid);
      } catch (x) {
        send1.disabled = false; $('rpCancel').disabled = false; send1.textContent = 'Submit report →';
        err.textContent = x.message === 'off' ? 'Reports cannot be sent from this browser.' : 'Your report could not be sent. Check your connection and try again; what you wrote is still here.';
      }
    };
    $('rpWhere').value ? $('rpCat').focus() : $('rpCat').focus();
  }
  return { open };
})();
