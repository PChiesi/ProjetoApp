(() => {
  if (window.__amInstalled) return;
  window.__amInstalled = true;
  let picking = false, box = null, tip = null, current = null;

  const css = (s) => (window.CSS && CSS.escape) ? CSS.escape(s) : s.replace(/([^\w-])/g, '\\$1');
  const uniq = (sel) => { try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; } };
  const dynamic = (s) => /\d{4,}|[a-f0-9]{8,}|^ember|^ext-|^ui-id|^mat-|^react|^:r/i.test(s || '');
  const clean = (t) => (t || '').replace(/\s+/g, ' ').trim();

  function labelOf(el) {
    if (el.id) {
      const l = document.querySelector(`label[for="${css(el.id)}"]`);
      if (l) return clean(l.innerText);
    }
    const aria = el.getAttribute('aria-label');
    if (aria) return clean(aria);
    const lb = el.getAttribute('aria-labelledby');
    if (lb) { const n = document.getElementById(lb.split(' ')[0]); if (n) return clean(n.innerText); }
    const wrap = el.closest('label');
    if (wrap) return clean(wrap.innerText);
    if (el.placeholder) return clean(el.placeholder);
    if (el.title) return clean(el.title);
    const tag = el.tagName.toLowerCase();
    if (['button', 'a', 'option', 'li', 'span', 'td', 'th', 'h1', 'h2', 'h3', 'h4', 'label', 'p', 'div'].includes(tag)) {
      const t = clean(el.innerText || el.value);
      if (t && t.length < 80) return t;
    }
    if (el.value && (el.type === 'submit' || el.type === 'button')) return clean(el.value);
    // texto anterior mais próximo (tabelas de formulário antigas)
    let p = el.parentElement, hops = 0;
    while (p && hops < 4) {
      let prev = p.previousElementSibling;
      if (prev) { const t = clean(prev.innerText); if (t && t.length < 60) return t.replace(/[:*]+$/, ''); }
      p = p.parentElement; hops++;
    }
    return el.name || el.id || tag;
  }

  function cssPath(el) {
    const parts = [];
    while (el && el.nodeType === 1 && parts.length < 8) {
      let part = el.tagName.toLowerCase();
      if (el.id && !dynamic(el.id)) { parts.unshift('#' + css(el.id)); break; }
      const parent = el.parentElement;
      if (parent) {
        const same = Array.from(parent.children).filter(c => c.tagName === el.tagName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(el) + 1})`;
      }
      parts.unshift(part);
      el = parent;
    }
    return parts.join(' > ');
  }

  function xpathOf(el) {
    const segs = [];
    for (; el && el.nodeType === 1; el = el.parentNode) {
      let i = 1;
      for (let s = el.previousSibling; s; s = s.previousSibling) if (s.nodeType === 1 && s.nodeName === el.nodeName) i++;
      segs.unshift(el.nodeName.toLowerCase() + '[' + i + ']');
    }
    return '/' + segs.join('/');
  }

  function selectors(el) {
    const out = [];
    const tag = el.tagName.toLowerCase();
    const add = (s) => { if (s && !out.includes(s) && uniq(s)) out.push(s); };
    for (const a of ['data-testid', 'data-test', 'data-qa', 'data-cy', 'formcontrolname', 'ng-model', 'data-field']) {
      const v = el.getAttribute(a); if (v) add(`[${a}="${v}"]`);
    }
    if (el.id && !dynamic(el.id)) add('#' + css(el.id));
    if (el.name) { add(`${tag}[name="${el.name}"]`); if (el.type === 'radio' && el.value) add(`${tag}[name="${el.name}"][value="${el.value}"]`); }
    const aria = el.getAttribute('aria-label'); if (aria) add(`${tag}[aria-label="${aria}"]`);
    if (el.placeholder) add(`${tag}[placeholder="${el.placeholder}"]`);
    if (el.id && dynamic(el.id)) add('#' + css(el.id));
    const txt = clean(el.innerText);
    if (['button', 'a'].includes(tag) && txt && txt.length < 50) {
      const sel = `${tag}:has-text("${txt.replace(/"/g, '\\"')}")`;
      if (!out.includes(sel)) out.push(sel);
    }
    const cp = cssPath(el); if (cp && !out.includes(cp)) out.push(cp);
    return out;
  }

  function kind(el) {
    const tag = el.tagName.toLowerCase(); const t = (el.type || '').toLowerCase();
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'select' || role === 'combobox' || role === 'listbox') return 'lista';
    if (tag === 'input') {
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (t === 'password') return 'senha';
      if (t === 'date' || t === 'datetime-local') return 'data';
      if (t === 'number') return 'numero';
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'botao';
      if (el.getAttribute('list')) return 'lista';
      return 'texto';
    }
    if (tag === 'textarea' || el.isContentEditable) return 'texto';
    if (tag === 'button' || tag === 'a' || role === 'button' || role === 'link' || role === 'menuitem') return 'botao';
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    if (role === 'tab') return 'aba';
    if (tag === 'table' || role === 'grid') return 'tabela';
    return 'rotulo';
  }

  function optionsOf(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return Array.from(el.options).map(o => [clean(o.text), o.value]);
    if (tag === 'input' && el.type === 'radio' && el.name) {
      return Array.from(document.querySelectorAll(`input[type=radio][name="${el.name}"]`)).map(r => [labelOf(r) || r.value, r.value]);
    }
    if (tag === 'input' && el.getAttribute('list')) {
      const dl = document.getElementById(el.getAttribute('list'));
      if (dl) return Array.from(dl.options).map(o => [o.label || o.value, o.value]);
    }
    const ctl = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (ctl) {
      const lb = document.getElementById(ctl);
      if (lb) return Array.from(lb.querySelectorAll('[role=option]')).map(o => [clean(o.innerText), o.getAttribute('data-value') || clean(o.innerText)]);
    }
    if (el.getAttribute('role') === 'listbox') return Array.from(el.querySelectorAll('[role=option]')).map(o => [clean(o.innerText), clean(o.innerText)]);
    return [];
  }

  function info(el) {
    const r = el.getBoundingClientRect();
    return {
      tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(), id: el.id || '', name: el.name || '',
      label: labelOf(el), kind: kind(el), options: optionsOf(el), selectors: selectors(el), xpath: xpathOf(el),
      value: ('value' in el) ? String(el.value || '') : clean(el.innerText).slice(0, 200),
      required: !!el.required || el.getAttribute('aria-required') === 'true',
      url: location.href, rect: [r.left, r.top, r.width, r.height]
    };
  }

  function ensureUi() {
    if (box) return;
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #4c6ef5;background:rgba(76,110,245,.12);border-radius:4px;transition:all .05s;display:none';
    tip = document.createElement('div');
    tip.style.cssText = 'position:fixed;z-index:2147483647;pointer-events:none;background:#1e2235;color:#fff;font:12px Segoe UI,Arial;padding:4px 8px;border-radius:6px;box-shadow:0 4px 14px rgba(0,0,0,.3);display:none;max-width:420px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis';
    document.documentElement.appendChild(box); document.documentElement.appendChild(tip);
  }

  function target(e) {
    let el = e.target;
    if (!el || el === box || el === tip) return null;
    if (el.tagName === 'OPTION') el = el.closest('select') || el;
    if (el.tagName === 'LABEL' && el.control) el = el.control;
    const inter = el.closest('button, a, select, input, textarea, [role=button], [role=combobox], [role=checkbox], [role=tab], [role=option], [contenteditable=true]');
    return inter || el;
  }

  document.addEventListener('mousemove', (e) => {
    if (!picking) return;
    ensureUi();
    const el = target(e); if (!el) return; current = el;
    const r = el.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left - 2 + 'px', top: r.top - 2 + 'px', width: r.width + 4 + 'px', height: r.height + 4 + 'px' });
    tip.textContent = `${kind(el).toUpperCase()} • ${labelOf(el)}`;
    Object.assign(tip.style, { display: 'block', left: Math.max(4, r.left) + 'px', top: Math.max(4, r.top - 28) + 'px' });
  }, true);

  const block = (e) => { if (picking) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); } };
  ['mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick', 'contextmenu'].forEach(n => document.addEventListener(n, block, true));
  document.addEventListener('click', (e) => {
    if (!picking) return;
    block(e);
    const el = target(e) || current; if (!el) return;
    box.style.borderColor = '#2f9e44';
    setTimeout(() => { if (box) box.style.borderColor = '#4c6ef5'; }, 400);
    try { window.__amPick && window.__amPick(info(el)); } catch (err) { console.error(err); }
  }, true);
  document.addEventListener('keydown', (e) => {
    if (picking && e.key === 'Escape') { block(e); try { window.__amPick && window.__amPick({ cancel: true }); } catch (err) {} }
  }, true);

  window.__amSetPicking = (v) => {
    picking = !!v;
    if (!picking && box) { box.style.display = 'none'; tip.style.display = 'none'; }
    document.documentElement.style.cursor = picking ? 'crosshair' : '';
  };

  window.__amFindMessages = (selList) => {
    const out = [];
    const seen = new Set();
    selList.forEach((sel) => {
      let nodes = [];
      try { nodes = Array.from(document.querySelectorAll(sel)); } catch (e) { return; }
      nodes.forEach((n, idx) => {
        if (seen.has(n)) return;
        const r = n.getBoundingClientRect();
        const st = getComputedStyle(n);
        if (r.width < 5 || r.height < 5 || st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return;
        seen.add(n);
        const titleEl = n.querySelector('.modal-title, .swal2-title, .ui-dialog-title, h1, h2, h3, h4, header');
        const btns = Array.from(n.querySelectorAll('button, [role=button], input[type=button], input[type=submit], a.btn'))
          .map(b => clean(b.innerText || b.value || b.getAttribute('aria-label'))).filter(Boolean);
        out.push({ selector: sel, index: idx, title: titleEl ? clean(titleEl.innerText) : '', text: clean(n.innerText).slice(0, 3000), buttons: btns });
      });
    });
    return out;
  };

  window.__amClickIn = (sel, idx, wanted) => {
    const n = document.querySelectorAll(sel)[idx]; if (!n) return false;
    const btns = Array.from(n.querySelectorAll('button, [role=button], input[type=button], input[type=submit], a.btn, .close, [data-dismiss], [data-bs-dismiss]'));
    const norm = (t) => clean(t).toLowerCase();
    for (const w of wanted) { const b = btns.find(b => norm(b.innerText || b.value || b.getAttribute('aria-label')) === w); if (b) { b.click(); return true; } }
    for (const w of wanted) { const b = btns.find(b => norm(b.innerText || b.value || b.getAttribute('aria-label')).includes(w)); if (b) { b.click(); return true; } }
    const close = n.querySelector('.close, .btn-close, [data-dismiss], [data-bs-dismiss], .swal2-confirm, .ui-dialog-titlebar-close');
    if (close) { close.click(); return true; }
    return false;
  };
})();
