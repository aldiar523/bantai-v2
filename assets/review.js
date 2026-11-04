/* BantAI v2 — reviewer tools on the contract page: the "What to check" checklist, the decision gate and the
   referral memo. A mark is a request to check, and the memo says so. Nothing here changes a mark.
   Everything stays in this browser for now (localStorage for ticks and comments, IndexedDB for files):
   recording decisions in one shared place is a separate open item. */
const BR = (() => {
  const esc = s => B.esc(s);
  const MAX_MB = 10, MAX_FILES = 5;
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } };
  const $ = id => document.getElementById(id);

  /* ---------- files: kept in this browser only ---------- */
  function idb() {
    return new Promise((ok, no) => {
      const r = indexedDB.open('bantai-files', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('files');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
  }
  async function fileOp(mode, fn) {
    const db = await idb();
    return new Promise((ok, no) => {
      const tx = db.transaction('files', mode), q = fn(tx.objectStore('files'));
      tx.oncomplete = () => ok(q.result);
      tx.onerror = tx.onabort = () => no(tx.error);
    });
  }
  async function sha256(buf) {
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map(x => x.toString(16).padStart(2, '0')).join('');
  }

  /* ---------- checklist ---------- */
  function mountChecklist(c, onChange) {
    const box = $('checklist');
    const all = read('bantai-checklist', {});
    const state = all[c.id] || (all[c.id] = {});
    const save = () => { if (!write('bantai-checklist', all)) $('clMsg').textContent = 'This browser could not save your ticks and comments.'; };
    const step = t => state[t] || (state[t] = { done: false, note: '', files: [] });
    const count = () => c.checks.filter(t => state[t] && state[t].done).length;
    const fileList = (t, i) => (step(t).files || []).map((f, j) => `<li><button type="button" class="cl-link" data-open="${i}:${j}">${esc(f.name)}</button> <span class="tiny muted">${(f.size / 1048576).toFixed(1)} MB</span> <button type="button" class="cl-x" data-del="${i}:${j}" aria-label="Remove ${esc(f.name)}">Remove</button></li>`).join('');
    box.innerHTML = `<div class="small" style="display:flex;justify-content:space-between;gap:12px"><span id="clCount"></span><span class="muted">Comments and files are optional</span></div>
      <div class="cl-bar"><span id="clBar"></span></div>` +
      c.checks.map((t, i) => `<div class="cl-step">
        <label class="cl-tick"><input type="checkbox" data-i="${i}" ${step(t).done ? 'checked' : ''}><span>${esc(t)}</span></label>
        <div class="cl-more">
          <label class="tiny muted" for="clNote${i}">Comment</label>
          <textarea id="clNote${i}" data-n="${i}" rows="2" placeholder="What you checked and what you found">${esc(step(t).note || '')}</textarea>
          <div class="cl-files"><label class="btn" style="min-height:36px;font-size:13px">Add file<input type="file" data-f="${i}" multiple hidden></label><span class="tiny muted">Up to ${MAX_FILES} files, ${MAX_MB} MB each. Files stay on this device.</span></div>
          <ul class="cl-list" id="clFiles${i}">${fileList(t, i)}</ul>
          <div class="err" id="clErr${i}" role="alert" style="min-height:0"></div>
        </div></div>`).join('') + '<p class="tiny muted" id="clMsg" role="status" style="margin:10px 0 0"></p>';
    const paint = () => {
      const d = count(), n = c.checks.length;
      $('clCount').innerHTML = `<b>${d} of ${n}</b> steps done`;
      $('clBar').style.width = (n ? 100 * d / n : 100) + '%';
    };
    box.addEventListener('change', async e => {
      const el = e.target;
      if (el.dataset.i !== undefined) {
        step(c.checks[+el.dataset.i]).done = el.checked; save(); paint(); onChange();
      }
      if (el.dataset.f !== undefined) {
        const i = +el.dataset.f, t = c.checks[i], s = step(t), err = $('clErr' + i);
        err.textContent = '';
        for (const f of [...el.files]) {
          if ((s.files || []).length >= MAX_FILES) { err.textContent = `This step already has ${MAX_FILES} files.`; break; }
          if (f.size > MAX_MB * 1048576) { err.textContent = `${f.name} is over ${MAX_MB} MB.`; continue; }
          try {
            const buf = await f.arrayBuffer(), id = (await sha256(buf));
            await fileOp('readwrite', o => o.put(new Blob([buf], { type: f.type }), `${c.id}/${id}`));
            s.files = s.files || [];
            if (!s.files.some(x => x.id === id)) s.files.push({ id, name: f.name, size: f.size, type: f.type });
          } catch (x) { err.textContent = 'This browser could not keep that file.'; }
        }
        el.value = ''; save(); $('clFiles' + i).innerHTML = fileList(t, i);
      }
    });
    box.addEventListener('input', e => {
      if (e.target.dataset.n !== undefined) { step(c.checks[+e.target.dataset.n]).note = e.target.value; save(); }
    });
    box.addEventListener('click', async e => {
      const o = e.target.dataset.open, d = e.target.dataset.del;
      if (o) {
        const [i, j] = o.split(':').map(Number), f = step(c.checks[i]).files[j];
        try {
          const blob = await fileOp('readonly', s => s.get(`${c.id}/${f.id}`));
          const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = f.name; a.click();
          setTimeout(() => URL.revokeObjectURL(a.href), 2000);
        } catch (x) { $('clErr' + i).textContent = 'That file is not on this device.'; }
      }
      if (d) {
        const [i, j] = d.split(':').map(Number), t = c.checks[i], s = step(t), f = s.files[j];
        s.files.splice(j, 1); save(); $('clFiles' + i).innerHTML = fileList(t, i);
        const used = Object.values(state).some(x => (x.files || []).some(y => y.id === f.id));
        if (!used) fileOp('readwrite', o2 => o2.delete(`${c.id}/${f.id}`)).catch(() => {});
      }
    });
    paint();
    return { allDone: () => count() === c.checks.length, done: count, state };
  }

  /* ---------- memo content ---------- */
  const OFFICES = {
    coa: { label: 'COA audit team for DPWH', to: r => `<mark>[Name]</mark>, Supervising Auditor, COA Audit Team for DPWH ${esc(r)}`, cc: () => 'Director, DPWH Internal Audit Service' },
    ias: { label: 'DPWH Internal Audit Service', to: () => 'Director, DPWH Internal Audit Service', cc: r => `<mark>[Name]</mark>, Supervising Auditor, COA Audit Team for DPWH ${esc(r)}` },
    omb: { label: 'Office of the Ombudsman', to: () => '<mark>[Name]</mark>, Deputy Ombudsman for <mark>[Luzon / Visayas / Mindanao]</mark>', cc: r => `<mark>[Name]</mark>, Supervising Auditor, COA Audit Team for DPWH ${esc(r)}; Director, DPWH Internal Audit Service` }
  };
  const WORK = { road: 'road', flood: 'flood control', bridge: 'bridge', building: 'building', water: 'water' };
  const iso = d => d.toLocaleDateString('en-CA');
  function addWorkdays(d, n) {
    const x = new Date(d);
    while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() % 6) n--; }
    return x;
  }
  function pesoWords(x) {
    if (x == null) return '';
    return x >= 1e9 ? `₱${(x / 1e9).toLocaleString('en-US', { maximumFractionDigits: 2 })} billion`
      : `₱${(x / 1e6).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} million`;
  }
  const STRENGTH = {
    A: 'Strong: an official body acted. Please confirm the record applies to this contract.',
    B: 'Needs documents: published figures against a written rule. It may be a breach or a data error.',
    S: "Weak alone: BantAI's own reading of open data. Not yet shown to predict problems."
  };
  const OVERALL = {
    A: 'An official record names this contract or its contractor. BantAI repeats what the source says and makes no judgement of its own.',
    B: 'The published figures appear to contradict a written rule. No document check has been done yet, so this may be a breach or a data entry error. Only the documents can tell.',
    C: 'Several independent risk families fire on this contract. Each has ordinary explanations. Tests so far, on 260 known problem contracts and an earlier version of these families, have not shown that they predict problems. The case rests on how such schemes work.'
  };

  function buildMemo({ c, list, pub, office, days, reviewerId, why, steps }) {
    const O = OFFICES[office], today = new Date(), due = addWorkdays(today, days);
    const reg = c.region || c.office;
    const place = [c.city, c.province].filter(Boolean).join(', ') || c.office;
    const kind = WORK[c.work_type] ? WORK[c.work_type] + ' ' : '';
    const peers = list.filter(x => x.tier === c.tier && (x.region || x.office) === reg).sort((a, b) => a.rank - b.rank);
    const pos = peers.findIndex(x => x.id === c.id) + 1;
    const amt = c.award || c.amount;

    const facts = [
      ['Contract ID', c.id, 'DPWH project list'],
      ['Project', c.title, 'DPWH project list'],
      ['Implementing office', [c.office, c.region !== c.office ? c.region : ''].filter(Boolean).join(', '), 'DPWH project list'],
      ['Location', [c.city, c.province].filter(Boolean).join(', '), 'PhilGEPS notice'],
      ['Approved budget (ABC)', c.abc ? pesoWords(c.abc) : '', 'PhilGEPS notice or DPWH bid record'],
      ['Contract amount', amt ? pesoWords(amt) + (c.abc ? ` (${(100 * amt / c.abc).toFixed(1)}% of ABC)` : '') : '', c.award ? 'PhilGEPS award notice' : 'DPWH project list'],
      ['Procurement mode', c.mode, 'PhilGEPS notice'],
      ['Notice of Award', c.award_date ? B.date(c.award_date) : '', 'PhilGEPS award notice or DPWH bid record'],
      ['Contractor', c.contractor + (c.jv ? ' (joint venture)' : '') + (c.licence ? `, PCAB licence ${c.licence}` : '') + (c.licence_cat ? `, category ${c.licence_cat}` : ''), 'DPWH project list; PCAB licence list'],
      ['Start', c.start ? B.date(c.start) : '', 'DPWH project list'],
      ['Planned completion', c.planned_end ? B.date(c.planned_end) : '', 'DPWH records'],
      ['Status', c.status + (c.progress != null ? `, ${c.progress.toFixed(1)}% done` : '') + ` (list of ${B.date(pub.snapshot)})`, 'DPWH project list']
    ].filter(r => r[1]);

    // Affiliation is a name match that no person has confirmed: it stays with the review team, and the memo says one is held.
    const held = c.reasons.some(r => r.family === 'Affiliation');
    const signs = c.reasons.filter(r => r.family !== 'Affiliation');
    const srcOf = r => r.source ? `<a href="${esc(r.source)}">${esc(r.source)}</a>` : (r.basis === 'S' ? 'BantAI reading of DPWH, PhilGEPS and CPES data' : 'DPWH and PhilGEPS data');
    const sign = r => r.basis === 'A' ? 'Official record' : r.basis === 'B' ? 'Rule check' : esc(r.family);

    const clear = [], missing = [];
    const seenM = new Set();
    const groups = [...c.matrix.A, ...c.matrix.B, ...c.matrix.C.flatMap(f => f.items)];
    groups.forEach(it => {
      if (/Managing officer/.test(it.name) && it.status !== 'clear') return;
      const name = it.name.replace(/\s*\(R\d\)/, '');   // internal rule codes mean nothing to the office
      if (it.status === 'clear') clear.push(name);
      if (it.status === 'nodata') { const k = `${name}: ${it.why}`; if (!seenM.has(k)) { seenM.add(k); missing.push(k); } }
    });

    // The identity step belongs to the unconfirmed lead, so it and any notes or files on it stay with the review team.
    const isLeadStep = t => /managing officer/i.test(t);
    const outSteps = steps.filter(s => !isLeadStep(s.text));
    const noted = outSteps.filter(s => s.note), files = outSteps.flatMap(s => s.files || []);
    const att = ['BantAI contract page printout', ...[...new Map(files.map(f => [f.id, f.name])).values()].map(n => `Reviewer file: ${n}`), 'Summary of how BantAI works and what has been tested'];
    const letter = i => String.fromCharCode(65 + i);
    const table = (w, head, rows) => `<table data-w="${w}"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(x => `<td>${x}</td>`).join('')}</tr>`).join('')}</tbody></table>`;

    return `
      <p class="m-lh"><mark>[OFFICE LETTERHEAD]</mark></p>
      <p class="m-title"><b>MEMORANDUM</b></p>
      <table class="m-head" data-w="14,86" data-plain="1"><tbody>
        <tr><td><b>To</b></td><td>${O.to(reg)}</td></tr>
        <tr><td><b>Copy</b></td><td>${O.cc(reg)}</td></tr>
        <tr><td><b>From</b></td><td>Project BantAI Review Desk (Reviewer ${reviewerId ? esc(reviewerId) : '<mark>[ID]</mark>'})</td></tr>
        <tr><td><b>Date</b></td><td>${B.date(iso(today))}</td></tr>
        <tr><td><b>Subject</b></td><td><b>Request for review: DPWH ${kind}contract ${esc(c.id)}, ${esc(place)}, ${pesoWords(c.amount)}</b></td></tr>
      </tbody></table>

      <h3>Background</h3>
      <p>Limited oversight capacity makes it hard to know which public works contracts need closer scrutiny first. The Commission on Audit's 2024 annual audit report on DPWH found 2,596 locally funded projects worth ₱138.23 billion not efficiently implemented.</p>
      <p>Project BantAI is a weekly screen of DPWH contracts using open data. It marks the open contracts to check first. Written rules set the marks, not AI. A person reviewed this contract and decided to refer it.</p>

      <h3>Action requested</h3>
      <p>We request your office to consider this contract for a desk review and to tell us your decision by <b>${B.date(iso(due))}</b>. <b>This is a request for review, not a finding of irregularity.</b></p>
      <p>The reviewer asks your office to look at this: ${esc(why)}</p>
      <p>The contract carries mark ${c.tier} (${esc(B.tierName[c.tier])}) on the list of ${B.date(pub.snapshot)}, method ${esc(pub.method)}. It is number ${pos} of ${peers.length} mark ${c.tier} contracts in ${esc(reg)}. Within a mark, larger contracts come first, so this is an order of size, not a score.</p>

      <h3>The contract</h3>
      ${table('24,50,26', ['Item', 'Value', 'Source'], facts.map(r => [`<b>${esc(r[0])}</b>`, esc(r[1]), esc(r[2])]))}

      <h3>Why it was marked, and how strong the evidence is</h3>
      <p>${OVERALL[c.tier]}</p>
      ${table('15,37,25,23', ['Sign', 'What the record shows', 'Strength of evidence', 'Source'], signs.map(r => [`<b>${sign(r)}</b>`, esc(r.text) + (r.note ? ` ${esc(r.note)}` : ''), STRENGTH[r.basis], srcOf(r)]))}
      ${held ? `<p>The review team also holds one unconfirmed lead, a name match only. It counts toward mark C, but it is not evidence and is left out here.${c.tier === 'C' && c.signals < 4 ? ' Without it, this contract would not reach mark C.' : ''} It can be discussed with your office on request.</p>` : ''}

      <h3>What we checked and did not flag</h3>
      ${clear.length ? `<ul>${clear.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p>No other check came back clear.</p>'}
      ${missing.length ? `<p><b>We could not check these. The data is missing or the check does not apply:</b></p><ul>${missing.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${c.context.length ? "<p>Context, not counted: the province's share of elected officials from political families is above the national average.</p>" : ''}

      <h3>Recommended review steps</h3>
      <p>We recommend a desk review covering these steps:</p>
      <ul class="m-box">${outSteps.map(x => `<li>☐ ${esc(x.text)}</li>`).join('')}</ul>
      ${noted.length ? `<h3>Reviewer's notes</h3><ul>${noted.map(s => `<li><b>${esc(s.text)}</b> ${esc(s.note)}</li>`).join('')}</ul>` : ''}

      <h3>Attachments</h3>
      <ul class="m-box">${att.map((x, i) => `<li>(${letter(i)}) ${esc(x)}</li>`).join('')}</ul>
      <p class="m-foot">A BantAI mark is a request to check. It does not say that anyone did wrong. List sealed with SHA-256 ${esc(pub.sha256)}.</p>`;
  }

  /* ---------- Word file, built from the memo as edited on screen ---------- */
  const xml = s => String(s).replace(/[&<>"]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m]));
  function runs(node, fmt = {}) {
    let out = '';
    node.childNodes.forEach(n => {
      if (n.nodeType === 3) {
        if (!n.nodeValue) return;
        const pr = (fmt.b ? '<w:b/>' : '') + (fmt.mark ? '<w:highlight w:val="yellow"/>' : '') + (fmt.small ? '<w:sz w:val="17"/>' : '');
        out += `<w:r>${pr ? `<w:rPr>${pr}</w:rPr>` : ''}<w:t xml:space="preserve">${xml(n.nodeValue.replace(/\s+/g, ' '))}</w:t></w:r>`;
      } else if (n.nodeType === 1) {
        const t = n.tagName;
        if (t === 'BR') out += '<w:r><w:br/></w:r>';
        else out += runs(n, { ...fmt, b: fmt.b || t === 'B' || t === 'STRONG', mark: fmt.mark || t === 'MARK', small: fmt.small || t === 'A' });
      }
    });
    return out;
  }
  const para = (inner, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`;
  function docBody(root) {
    const W = 9360; // text width in twips: Letter with 1-inch margins, as in the team's sample
    let out = '';
    [...root.children].forEach(el => {
      const t = el.tagName;
      if (t === 'H3') out += para(runs(el, { b: true }), '<w:keepNext/><w:spacing w:before="200" w:after="80"/>');
      else if (t === 'P') out += para(runs(el), `<w:spacing w:after="100"/>${el.classList.contains('m-title') || el.classList.contains('m-lh') ? '<w:jc w:val="center"/>' : ''}`);
      else if (t === 'UL' || t === 'OL') {
        const bullet = !el.classList.contains('m-box');
        [...el.children].forEach(li => { out += para((bullet ? '<w:r><w:t xml:space="preserve">•  </w:t></w:r>' : '') + runs(li), '<w:spacing w:after="60"/><w:ind w:left="360" w:hanging="360"/>'); });
      } else if (t === 'TABLE') {
        const plain = el.dataset.plain, cols = (el.dataset.w || '').split(',').map(x => Math.round(W * +x / 100));
        const bd = plain ? 'none' : 'single';
        const borders = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(k => `<w:${k} w:val="${bd}" w:sz="4" w:space="0" w:color="999999"/>`).join('');
        out += `<w:tbl><w:tblPr><w:tblW w:w="${W}" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="80" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${cols.map(x => `<w:gridCol w:w="${x}"/>`).join('')}</w:tblGrid>`;
        el.querySelectorAll('tr').forEach(tr => {
          const head = !!tr.closest('thead');
          out += `<w:tr>${head ? '<w:trPr><w:tblHeader/></w:trPr>' : '<w:trPr><w:cantSplit/></w:trPr>'}` + [...tr.children].map((td, i) => `<w:tc><w:tcPr><w:tcW w:w="${cols[i]}" w:type="dxa"/>${head ? '<w:shd w:val="clear" w:color="auto" w:fill="E7E6E6"/>' : ''}</w:tcPr>${para(runs(td, { b: head }), '<w:spacing w:before="30" w:after="30"/>')}</w:tc>`).join('') + '</w:tr>';
        });
        out += '</w:tbl>' + para('', '<w:spacing w:after="60"/>');
      }
    });
    return out;
  }
  const crcT = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc = b => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const te = new TextEncoder(), parts = [], cen = [];
    let off = 0;
    const u16 = n => [n & 255, n >>> 8 & 255], u32 = n => [n & 255, n >>> 8 & 255, n >>> 16 & 255, n >>> 24 & 255];
    Object.entries(files).forEach(([name, text]) => {
      const nm = te.encode(name), data = te.encode(text), cr = crc(data);
      const common = [...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(33), ...u32(cr), ...u32(data.length), ...u32(data.length), ...u16(nm.length), ...u16(0)];
      const local = new Uint8Array([0x50, 0x4B, 3, 4, ...common]);
      parts.push(local, nm, data);
      cen.push(new Uint8Array([0x50, 0x4B, 1, 2, ...u16(20), ...common, ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
      off += local.length + nm.length + data.length;
    });
    const size = cen.reduce((a, x) => a + x.length, 0), n = Object.keys(files).length;
    return new Blob([...parts, ...cen, new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...u16(n), ...u16(n), ...u32(size), ...u32(off), 0, 0])],
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }
  function toDocx(root) {
    const ns = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
    return zip({
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>',
      '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      'word/_rels/document.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
      'word/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${ns}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="20"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`,
      'word/document.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${ns}><w:body>${docBody(root)}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`
    });
  }

  /* ---------- memo window ---------- */
  function openMemo(html, c) {
    document.getElementById('memoOv')?.remove();
    const last = document.activeElement;
    const ov = document.createElement('div');
    ov.id = 'memoOv'; ov.setAttribute('role', 'dialog'); ov.setAttribute('aria-modal', 'true'); ov.setAttribute('aria-label', 'Referral memo');
    ov.innerHTML = `<div class="memo-bar"><div class="memo-tools">
        <button class="btn dark" id="mPrint">Print or save as PDF</button><button class="btn" id="mWord">Download Word file</button><button class="btn" id="mCopy">Copy text</button><button class="btn" id="mClose">Close</button></div>
        <p class="small" role="status" id="mMsg">Draft. Read it, fill in the yellow parts and edit anything here. Do not name private individuals. Edits are lost when you close, so download first.</p></div>
      <div class="memo-paper" id="memoDoc" contenteditable="true" spellcheck="true">${html}</div>`;
    document.body.appendChild(ov);
    document.body.classList.add('memo-open');
    const close = () => { ov.remove(); document.body.classList.remove('memo-open'); document.removeEventListener('keydown', onKey); last && last.focus(); };
    const onKey = e => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);
    const doc = $('memoDoc'), msg = $('mMsg');
    $('mClose').onclick = close;
    $('mPrint').onclick = () => print();
    $('mCopy').onclick = async () => {
      try { await navigator.clipboard.writeText(doc.innerText); msg.textContent = 'Copied as text.'; }
      catch (e) { msg.textContent = 'This browser blocked copying. Select the text and copy it by hand.'; }
    };
    $('mWord').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(toDocx(doc)); a.download = `BantAI_referral_memo_${c.id}.docx`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      msg.textContent = 'Word file downloaded.';
    };
    $('mClose').focus();
  }

  /* ---------- decision panel ---------- */
  const LOCKED = new Set(['escalate', 'clear']);
  function mount({ c, list }) {
    const cl = mountChecklist(c, () => gate());
    const all = read('bantai-decisions', {}), mine = all[c.id] || {};
    let pick = mine.pick || null;
    $('why').value = mine.why || '';
    const buttons = [...document.querySelectorAll('[data-d]')];
    const panel = $('memoPanel'), derr = $('derr');
    panel.innerHTML = `<div style="border-top:1px solid var(--line2);margin-top:18px;padding-top:16px">
      <label class="small mf" for="mTo">Send to</label><select id="mTo" class="mi">${Object.entries(OFFICES).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('')}</select>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div><label class="small mf" for="mDays">Reply within (working days)</label><input id="mDays" class="mi" type="number" min="1" max="90" value="15"></div>
        <div><label class="small mf" for="mRev">Your reviewer ID</label><input id="mRev" class="mi" maxlength="20" placeholder="R-03" value="${esc(read('bantai-reviewer-tag', ''))}"></div></div>
      <button class="btn dark" id="mGen" style="width:100%;justify-content:center;min-height:44px;margin-top:14px">Generate referral memo</button>
      <p class="tiny muted" style="margin:8px 0 0">A request for review, never a finding. The memo uses your reason above.</p></div>`;
    function persist() {
      all[c.id] = { pick, why: $('why').value.trim(), at: new Date().toISOString() };
      write('bantai-decisions', all);
    }
    function gate() {
      const open = cl.allDone(), n = c.checks.length;
      if (!open && LOCKED.has(pick)) {
        if (all[c.id]) { delete all[c.id].pick; write('bantai-decisions', all); }
        pick = null; derr.textContent = 'A step is no longer ticked, so that decision was cleared.';
      }
      buttons.forEach(b => {
        const lock = !open && LOCKED.has(b.dataset.d);
        b.disabled = lock; b.setAttribute('aria-disabled', String(lock));
        b.title = lock ? `Tick all ${n} steps in What to check first` : '';
        b.classList.toggle('on', b.dataset.d === pick); b.setAttribute('aria-checked', String(b.dataset.d === pick));
      });
      $('gate').innerHTML = open ? 'All steps are done. Every decision is open.' : `<b>Monitor</b> and <b>Data error</b> are open now. <a href="#whatToCheck">Tick all ${n} steps</a> to unlock <b>Escalate</b> and <b>No concern</b>.`;
      panel.hidden = pick !== 'escalate';
    }
    buttons.forEach(b => b.onclick = () => { if (b.disabled) return; pick = b.dataset.d; derr.textContent = ''; gate(); });
    $('save').onclick = () => {
      if (!pick) { derr.textContent = 'Choose a decision first.'; return; }
      persist();
      const s = $('save'); s.textContent = 'Saved'; setTimeout(() => s.textContent = 'Save decision', 1500);
    };
    $('mGen').onclick = async () => {
      const why = $('why').value.trim();
      if (!why) { derr.textContent = 'Write your reason first. The memo tells the office what to look at.'; $('why').focus(); return; }
      derr.textContent = ''; persist();
      const rev = $('mRev').value.trim(); write('bantai-reviewer-tag', rev);
      const days = Math.max(1, Math.min(90, parseInt($('mDays').value, 10) || 15));
      const steps = c.checks.map(t => ({ text: t, ...(cl.state[t] || {}) }));
      const pub = await B.publicData();
      openMemo(buildMemo({ c, list, pub, office: $('mTo').value, days, reviewerId: rev, why, steps }), c);
    };
    gate();
  }
  return { mount };
})();
