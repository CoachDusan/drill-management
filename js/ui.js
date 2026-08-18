/* ui.js — small shared helpers so the view files stay about basketball,
   not about DOM plumbing. No framework; just a tidy element builder. */

/** h('div', {class:'card'}, [child, 'text']) -> HTMLElement */
export function h(tag, props = {}, children = []) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'value') el.value = v;
    else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = !!v;
    else el.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }

export function mount(el, ...nodes) { clear(el); nodes.flat().filter(Boolean).forEach((n) => el.appendChild(n)); return el; }

/* ---- toast ------------------------------------------------------------ */

let toastTimer = null;
export function toast(message) {
  let t = document.getElementById('toast');
  if (!t) { t = h('div', { id: 'toast' }); document.body.appendChild(t); }
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
}

/* ---- modal -------------------------------------------------------------
 * openModal(title, buildBody) -> Promise that resolves with whatever the body
 * passes to `done(value)`, or null if dismissed.
 */
export function openModal(title, build, { confirmLabel = 'Save', cancelLabel = 'Cancel', wide = false } = {}) {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim' });
    const body = h('div', {});
    let finish = (v) => { close(v); };

    function close(value) {
      scrim.remove();
      document.removeEventListener('keydown', onKey);
      resolve(value === undefined ? null : value);
    }
    function onKey(e) { if (e.key === 'Escape') close(null); }

    const onConfirm = build(body, (v) => finish(v), () => close(null));

    const actions = h('div', { class: 'modal-actions' }, [
      h('button', { class: 'btn', onclick: () => close(null) }, cancelLabel),
      onConfirm ? h('button', { class: 'btn btn-primary', onclick: () => onConfirm() }, confirmLabel) : null,
    ]);

    const modal = h('div', { class: 'modal', style: wide ? { maxWidth: '860px' } : {} }, [
      h('h2', { text: title }), body, actions,
    ]);
    scrim.appendChild(modal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(null); });
    document.addEventListener('keydown', onKey);
    document.body.appendChild(scrim);

    const firstInput = modal.querySelector('input, select, textarea');
    if (firstInput && window.matchMedia('(min-width: 721px)').matches) firstInput.focus();
  });
}

/** Yes/no confirmation with a red action button. Resolves true or false. */
export function confirmDanger(title, message, confirmLabel = 'Delete') {
  return new Promise((resolve) => {
    const scrim = h('div', { class: 'scrim' });
    const close = (v) => { scrim.remove(); resolve(v); };
    const modal = h('div', { class: 'modal' }, [
      h('h2', { text: title }),
      h('p', { class: 'muted', text: message }),
      h('div', { class: 'modal-actions' }, [
        h('button', { class: 'btn', onclick: () => close(false) }, 'Cancel'),
        h('button', { class: 'btn btn-danger', onclick: () => close(true) }, confirmLabel),
      ]),
    ]);
    scrim.appendChild(modal);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(false); });
    document.body.appendChild(scrim);
  });
}

/* ---- form field builders ------------------------------------------------ */

export function field(label, control, hint) {
  return h('label', { class: 'field' }, [
    h('span', { class: 'lbl', text: label }),
    control,
    hint ? h('div', { class: 'tiny', style: { marginTop: '4px' }, text: hint }) : null,
  ]);
}

export function textInput(value = '', props = {}) {
  return h('input', { type: 'text', value, ...props });
}

export function numberInput(value = '', props = {}) {
  return h('input', { type: 'number', value, inputmode: 'numeric', ...props });
}

export function selectInput(options, value, props = {}) {
  const sel = h('select', props);
  for (const o of options) {
    const opt = typeof o === 'string' ? { value: o, label: o } : o;
    sel.appendChild(h('option', { value: opt.value, selected: String(opt.value) === String(value) }, opt.label));
  }
  sel.value = value;
  return sel;
}

export function emptyState(icon, title, message, action) {
  return h('div', { class: 'empty' }, [
    h('div', { class: 'big', text: icon }),
    h('h3', { text: title }),
    h('p', { class: 'small', text: message }),
    action || null,
  ]);
}

export function stat(key, value, { unit = '', note = '', flag = null } = {}) {
  return h('div', { class: 'stat' }, [
    h('div', { class: 'k', text: key }),
    h('div', { class: 'v' }, [String(value), unit ? h('span', { class: 'u', text: unit }) : null]),
    flag ? h('span', { class: `flag ${flag.level}`, text: flag.text }) : (note ? h('div', { class: 'n', text: note }) : null),
  ]);
}

/** Download a blob without a server. */
export function downloadFile(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: filename });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Ask the user for a file and hand back its text. */
export function pickFile(accept = '.json') {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'hidden' });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => { resolve({ name: file.name, text: String(reader.result) }); input.remove(); };
      reader.onerror = () => { resolve(null); input.remove(); };
      reader.readAsText(file);
    });
    document.body.appendChild(input);
    input.click();
  });
}

export function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}
