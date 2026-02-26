// Simple helper to create a standardized header tools container for any view.
// Replaces the previous kanji-specific header container.

import { createDropdown as _createDropdown } from './dropdown.js';

// Config-driven header tools creator
// Example usage:
// createViewHeaderTools({
//   elements: [
//     { type: 'button', key: 'shuffle', label: 'Shuffle', onClick: ... },
//     { type: 'dropdown', key: 'fields', items: [...], value, onChange: ... },
//     ...
//   ]
// })
export function createViewHeaderTools(opts = {}) {
  const { elements = [], className = '', style = {} } = opts || {};
  const el = document.createElement('div');
  el.className = 'view-header-tools' + (className ? ' ' + className : '');
  Object.assign(el.style, style);

  // Store references to created controls by key -> { el: controlEl, group }
  const controls = {};

  // Helper: create a group with optional caption
  function wrapGroup(controlEl, captionText) {
    const group = document.createElement('div');
    group.className = 'data-expansion-group';
    if (controlEl) group.appendChild(controlEl);
    if (captionText) {
      const caption = document.createElement('div');
      caption.className = 'data-expansion-caption';
      caption.textContent = String(captionText);
      group.appendChild(caption);
    }
    return group;
  }

  // helper to create a control from config
  function createControlFromConfig(elem) {
    if (!elem || typeof elem !== 'object') return null;
    let control = null;
    if (elem.type === 'button') {
      control = document.createElement('button');
      control.type = elem.buttonType || 'button';
      control.className = elem.className || 'btn small';
      control.textContent = elem.label || elem.text || '';
      if (elem.title) control.title = elem.title;
      if (elem.disabled) control.disabled = true;
      if (elem.ariaPressed !== undefined) control.setAttribute('aria-pressed', String(!!elem.ariaPressed));
      if (elem.attrs && typeof elem.attrs === 'object') {
        for (const [k, v] of Object.entries(elem.attrs)) {
          control.setAttribute(k, v);
        }
      }
      if (typeof elem.onClick === 'function') {
        control.addEventListener('click', (ev) => {
          // call provided handler
          elem.onClick(ev);
          // support simple state binding: elem.state can be { obj, prop } or { get, set }
          try {
            if (elem.state) {
              if (typeof elem.state.get === 'function' && typeof elem.state.set === 'function') {
                // toggle
                const cur = !!elem.state.get();
                elem.state.set(!cur);
                control.setAttribute('aria-pressed', String(!cur));
              } else if (elem.state.obj && elem.state.prop) {
                const cur = !!elem.state.obj[elem.state.prop];
                try { elem.state.obj[elem.state.prop] = !cur; } catch (e) {}
                control.setAttribute('aria-pressed', String(!cur));
              }
            }
          } catch (e) {}
        });
      }
      // initial state reflect
      try {
        if (elem.state) {
          if (typeof elem.state.get === 'function') control.setAttribute('aria-pressed', String(!!elem.state.get()));
          else if (elem.state.obj && elem.state.prop) control.setAttribute('aria-pressed', String(!!elem.state.obj[elem.state.prop]));
        }
      } catch (e) {}
    } else if (elem.type === 'dropdown' && typeof elem.createDropdown === 'function') {
      control = elem.createDropdown(elem);
    } else if (elem.type === 'dropdown') {
      // convenience: use local createDropdown factory when apps pass items/value/onChange
      try {
        control = _createDropdown({
          items: elem.items || [],
          value: elem.value,
          values: elem.values,
          multi: !!elem.multi,
          commitOnClose: !!elem.commitOnClose,
          getButtonLabel: elem.getButtonLabel,
          onChange: elem.onChange,
          includeAllNone: !!elem.includeAllNone,
          className: elem.className || elem.dropdownClassName || 'data-expansion-dropdown',
          closeOverlaysOnOpen: elem.closeOverlaysOnOpen,
        });
      } catch (e) { control = null; }
    } else if (elem.type === 'custom' && typeof elem.create === 'function') {
      control = elem.create(elem);
    }
    if (control) {
      const key = elem.key || elem.label || elem.text;
      const group = wrapGroup(control, elem.caption);
      el.appendChild(group);
      controls[key] = { el: control, group };
      return { control, group };
    }
    return null;
  }

  // Main: iterate initial elements config
  for (const elem of elements) createControlFromConfig(elem);

  // Expose API for dynamic additions and control management
  el.addElement = (elem) => createControlFromConfig(elem);
  el.getControl = (key) => (controls[key] ? controls[key].el : undefined);
  el.getControls = () => Object.fromEntries(Object.entries(controls).map(([k, v]) => [k, v.el]));
  el.removeControl = (key) => {
    try {
      const rec = controls[key];
      if (!rec) return false;
      try { if (rec.group && rec.group.parentNode) rec.group.parentNode.removeChild(rec.group); } catch (e) {}
      delete controls[key];
      return true;
    } catch (e) { return false; }
  };
  el.clear = () => {
    try { el.innerHTML = ''; } catch (e) {}
    for (const k of Object.keys(controls)) delete controls[k];
  };

  return el;
}

// Three-state toggle for study filter: 'off' | 'skipLearned' | 'focusOnly'
export function createStudyFilterToggle({ state = 'off', onChange = null } = {}) {
  const el = document.createElement('div');
  el.className = 'three-toggle';

  const btnOff = document.createElement('button');
  btnOff.type = 'button';
  btnOff.className = 'toggle-option';
  btnOff.dataset.value = 'off';
  btnOff.textContent = 'All';

  const btnSkip = document.createElement('button');
  btnSkip.type = 'button';
  btnSkip.className = 'toggle-option';
  btnSkip.dataset.value = 'skipLearned';
  btnSkip.textContent = 'Skip Learned';

  const btnFocus = document.createElement('button');
  btnFocus.type = 'button';
  btnFocus.className = 'toggle-option';
  btnFocus.dataset.value = 'focusOnly';
  btnFocus.textContent = 'Focus';

  el.append(btnOff, btnSkip, btnFocus);

  function setState(next) {
    state = next || 'off';
    [btnOff, btnSkip, btnFocus].forEach(b => b.classList.toggle('active', b.dataset.value === state));
    // reflect aria-pressed
    [btnOff, btnSkip, btnFocus].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === state)));
  }

  function handleClick(e) {
    const v = (e.currentTarget && e.currentTarget.dataset && e.currentTarget.dataset.value) ? e.currentTarget.dataset.value : null;
    if (!v) return;
    // toggle behavior: clicking active option returns to 'off' when clicking center? We'll use explicit cycles.
    if (v === state) {
      // if clicking the active option, reset to off
      setState('off');
      if (typeof onChange === 'function') onChange('off');
      return;
    }
    setState(v);
    if (typeof onChange === 'function') onChange(v);
  }

  btnOff.addEventListener('click', handleClick);
  btnSkip.addEventListener('click', handleClick);
  btnFocus.addEventListener('click', handleClick);

  // keyboard support
  [btnOff, btnSkip, btnFocus].forEach(b => b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); b.click(); } }));

  // expose small API
  return { el, setState, getState: () => state };
}
