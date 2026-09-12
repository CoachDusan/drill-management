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

/* ---- drag to reorder ---------------------------------------------------
 *
 * Practice does not always get recorded in the order it happened — a clock
 * gets started late, two groups stop out of sequence, a drill is logged from
 * memory afterwards. So the running order has to be draggable.
 *
 * Pointer events, not HTML5 drag-and-drop: HTML5 dnd does not fire from a
 * finger, and this runs on a tablet. The drag starts from a grip handle rather
 * than the row itself, so tapping a row still opens it — a whole-row drag
 * would swallow every tap.
 *
 * `onReorder` is handed the ids in their new order, once, on drop.
 */
export function reorderable(container, onReorder) {
  let dragging = null;
  let moved = false;

  container.addEventListener('pointerdown', (e) => {
    const grip = e.target && e.target.closest ? e.target.closest('[data-grip]') : null;
    if (!grip) return;
    const row = grip.closest('[data-id]');
    if (!row) return;

    dragging = row;
    moved = false;
    row.classList.add('dragging');
    if (grip.setPointerCapture) grip.setPointerCapture(e.pointerId);
    e.preventDefault();
  });

  container.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    e.preventDefault();
    const after = rowAfter(container, e.clientY, dragging);
    if (after === dragging) return;
    moved = true;
    if (after) container.insertBefore(dragging, after);
    else container.appendChild(dragging);
  });

  const end = () => {
    if (!dragging) return;
    dragging.classList.remove('dragging');
    dragging = null;
    if (!moved) return;
    const ids = [...container.querySelectorAll('[data-id]')].map((el) => el.getAttribute('data-id'));
    onReorder(ids);
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);

  return container;
}

/** The row the dragged one should be inserted before, given a pointer Y. */
function rowAfter(container, y, dragging) {
  let best = null;
  let bestOffset = Number.NEGATIVE_INFINITY;
  for (const el of container.querySelectorAll('[data-id]')) {
    if (el === dragging) continue;
    const box = el.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > bestOffset) { bestOffset = offset; best = el; }
  }
  return best;
}

/** A grip the finger can grab without stealing the row's own tap. */
export function grip() {
  return h('span', {
    'data-grip': '1',
    class: 'grip',
    title: 'Drag to reorder',
    text: '\u2261',
    onclick: (e) => e.stopPropagation(),
  });
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
  downloadBlob(filename, new Blob([text], { type }));
}

/** Save a ready-made file (a PDF report) to the device's Downloads. */
export function downloadBlob(filename, blob) {
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

/** Ask for an image and hand back { name, dataUrl }. */
export function pickImage() {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp', class: 'hidden' });
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => { resolve({ name: file.name, dataUrl: String(reader.result) }); input.remove(); };
      reader.onerror = () => { resolve(null); input.remove(); };
      reader.readAsDataURL(file);
    });
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Shrink an image to fit `max` pixels on its longest side, as PNG.
 *
 * A logo straight off a phone can be several MB, and it lives in the database
 * and therefore in every backup file. A few hundred pixels is plenty for the
 * corner of a PDF. PNG keeps a transparent background transparent.
 */
export function shrinkImage(dataUrl, max = 480) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('That file is not an image this device can read.'));
    img.src = dataUrl;
  });
}

export function csvEscape(v) {
  const s = v === null || v === undefined ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows) {
  return rows.map((r) => r.map(csvEscape).join(',')).join('\n');
}
