import { el } from '../../utils/browser/ui.js';
import { createDropdown } from '../shared/dropdown.js';
import { getLanguageCode, speak } from '../../utils/browser/speech.js';

function asString(v) {
  return (v == null) ? '' : String(v);
}

function deepClone(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch (e) { return value; }
}

function normalizeLangTag(lang) {
  const raw = asString(lang).trim();
  if (!raw) return '';
  const parts = raw.replace(/_/g, '-').split('-').filter(Boolean);
  if (!parts.length) return '';
  if (parts.length === 1) return parts[0].toLowerCase();
  return `${parts[0].toLowerCase()}-${parts.slice(1).join('-').toUpperCase()}`;
}

function getDisplayNames() {
  try {
    return {
      language: new Intl.DisplayNames(undefined, { type: 'language' }),
      region: new Intl.DisplayNames(undefined, { type: 'region' }),
    };
  } catch (e) {
    return { language: null, region: null };
  }
}

function formatLanguageLabel(lang, displayNames = null) {
  const normalized = normalizeLangTag(lang);
  if (!normalized) return '';
  const [languageCode, regionCode] = normalized.split('-');
  if (!languageCode) return normalized;

  const languageName = displayNames?.language?.of?.(languageCode) || languageCode;
  const regionName = regionCode ? (displayNames?.region?.of?.(regionCode) || regionCode) : '';
  return regionName ? `${languageName} (${regionName})` : String(languageName);
}

function hasLanguageSupport(supportedLangs = [], lang = '') {
  const normalized = normalizeLangTag(lang);
  if (!normalized) return false;
  const lower = normalized.toLowerCase();
  const prefix = lower.split('-')[0];
  return (Array.isArray(supportedLangs) ? supportedLangs : []).some((candidate) => {
    const supported = normalizeLangTag(candidate).toLowerCase();
    if (!supported) return false;
    if (supported === lower) return true;
    return supported.split('-')[0] === prefix;
  });
}

function normalizeSpeechConfig(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const out = {};
  if (src.fields && typeof src.fields === 'object' && !Array.isArray(src.fields)) {
    out.fields = {};
    for (const [fieldKey, value] of Object.entries(src.fields)) {
      const key = asString(fieldKey).trim();
      if (!key || !value || typeof value !== 'object' || Array.isArray(value)) continue;
      const next = {};
      const lang = normalizeLangTag(value.lang);
      if (lang) next.lang = lang;
      if (value.rate != null && value.rate !== '') {
        const rate = Number(value.rate);
        if (Number.isFinite(rate)) next.rate = rate;
      }
      if (Object.keys(next).length) out.fields[key] = next;
    }
  }
  if (src.languages && typeof src.languages === 'object' && !Array.isArray(src.languages)) {
    out.languages = deepClone(src.languages);
  }
  return out;
}

function cleanupSpeechConfig(raw) {
  const next = normalizeSpeechConfig(raw);
  if (next.fields && typeof next.fields === 'object') {
    for (const key of Object.keys(next.fields)) {
      if (!next.fields[key] || Object.keys(next.fields[key]).length === 0) delete next.fields[key];
    }
    if (Object.keys(next.fields).length === 0) delete next.fields;
  }
  if (next.languages && typeof next.languages === 'object' && Object.keys(next.languages).length === 0) {
    delete next.languages;
  }
  return next;
}

function getLanguageItems(fields = [], voices = [], speechConfig = null) {
  const displayNames = getDisplayNames();
  const base = [
    { value: '', label: 'Auto' },
  ];
  const seen = new Set(base.map((item) => asString(item.value).toLowerCase()));
  const supportedLangs = Array.from(new Set(
    (Array.isArray(voices) ? voices : [])
      .map((voice) => normalizeLangTag(voice?.lang))
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  const expectedLangs = Array.from(new Set(
    [
      ...(Array.isArray(fields) ? fields : [])
        .map((field) => normalizeLangTag(getLanguageCode(field?.fieldKey || field?.value || '', field?.collectionKey || field?.collectionCategory || ''))),
      ...Object.values((speechConfig?.fields && typeof speechConfig.fields === 'object') ? speechConfig.fields : {})
        .map((fieldCfg) => normalizeLangTag(fieldCfg?.lang)),
    ]
      .filter(Boolean)
  )).sort((a, b) => a.localeCompare(b));

  for (const lang of supportedLangs) {
    const key = lang.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    base.push({
      value: lang,
      label: formatLanguageLabel(lang, displayNames),
      rightText: lang,
    });
  }

  for (const lang of expectedLangs) {
    const key = lang.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    base.push({
      value: lang,
      label: `${formatLanguageLabel(lang, displayNames)} not installed`,
      rightText: lang,
      disabled: !hasLanguageSupport(supportedLangs, key),
    });
  }
  return base;
}

function getRateItems() {
  const out = [{ value: '', label: 'Auto' }];
  for (let rate = 0.5; rate <= 1.5001; rate += 0.1) {
    const rounded = Math.round(rate * 10) / 10;
    out.push({ value: String(rounded), label: rounded.toFixed(1) });
  }
  return out;
}

export function openSpeechSettingsDialog({
  fields = [],
  speechConfig = null,
  collectionKey = '',
} = {}) {
  return new Promise((resolve) => {
    const normalizedFields = (Array.isArray(fields) ? fields : [])
      .map((field) => {
        const fieldKey = asString(field?.fieldKey || field?.value).trim();
        if (!fieldKey) return null;
        return {
          fieldKey,
          label: asString(field?.label || `entry.${fieldKey}`) || `entry.${fieldKey}`,
          sampleText: asString(field?.sampleText || field?.sample || field?.fieldKey || field?.value || '').trim(),
          collectionKey: asString(field?.collectionKey || field?.collectionCategory || collectionKey).trim(),
        };
      })
      .filter(Boolean);

    const draft = normalizeSpeechConfig(speechConfig);
    if (!draft.fields) draft.fields = {};

    const backdrop = el('div', { className: 'view-footer-hotkey-backdrop' });
    const dialog = el('div', {
      className: 'view-footer-hotkey-dialog',
      attrs: {
        role: 'dialog',
        'aria-modal': 'true',
        'aria-label': 'Speech settings',
      }
    });
    dialog.tabIndex = -1;
    dialog.style.maxWidth = '48rem';
    dialog.style.width = 'min(48rem, calc(100vw - 2rem))';

    const title = el('div', { className: 'view-footer-hotkey-title', text: 'Speech Settings' });
    const hint = el('div', { className: 'hint', text: 'These settings are saved per collection and used by speech actions in study views.' });
    const table = el('div', { className: 'view-footer-custom-available-list' });

    const actions = el('div', { className: 'view-footer-hotkey-actions' });
    const cancelBtn = el('button', { className: 'btn small', text: 'Cancel' });
    cancelBtn.type = 'button';
    const saveBtn = el('button', { className: 'btn small', text: 'Save' });
    saveBtn.type = 'button';
    actions.append(cancelBtn, saveBtn);

    dialog.append(title, hint, table, actions);

    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    const prevFocus = document.activeElement;
    mount.append(backdrop, dialog);

    const rateItems = getRateItems();
    let currentVoices = window.speechSynthesis?.getVoices?.() || [];
    let voicesChangedHandler = null;

    function getFieldDraft(fieldKey) {
      const key = asString(fieldKey).trim();
      if (!key) return {};
      const current = (draft.fields && draft.fields[key] && typeof draft.fields[key] === 'object') ? draft.fields[key] : {};
      draft.fields[key] = { ...current };
      return draft.fields[key];
    }

    function syncFieldDraft(fieldKey, patch = {}) {
      const current = getFieldDraft(fieldKey);
      const next = { ...current, ...patch };
      if (!next.lang) delete next.lang;
      if (next.rate == null || next.rate === '') delete next.rate;
      if (Object.keys(next).length === 0) delete draft.fields[fieldKey];
      else draft.fields[fieldKey] = next;
    }

    function renderRows() {
      const languageItems = getLanguageItems(normalizedFields, currentVoices, draft);
      table.innerHTML = '';
      const header = el('div', { className: 'view-footer-custom-available-header' });
      header.style.gridTemplateColumns = 'minmax(10rem, 1fr) minmax(11rem, 1fr) minmax(8rem, 8rem) auto auto';
      header.append(
        el('div', { className: 'view-footer-custom-action-label header', text: 'Field' }),
        el('div', { className: 'view-footer-action-field header', text: 'Language' }),
        el('div', { className: 'view-footer-action-field header', text: 'Rate' }),
        el('div', { className: 'view-footer-action-field header', text: '' }),
        el('div', { className: 'view-footer-action-field header', text: '' })
      );
      table.appendChild(header);

      for (const field of normalizedFields) {
        const row = el('div', { className: 'view-footer-custom-available-row' });
        row.style.gridTemplateColumns = 'minmax(10rem, 1fr) minmax(11rem, 1fr) minmax(8rem, 8rem) auto auto';

        const fieldConfig = getFieldDraft(field.fieldKey);
        const inferredLang = normalizeLangTag(fieldConfig.lang || getLanguageCode(field.fieldKey, field.collectionKey));
        const langDropdown = createDropdown({
          items: languageItems,
          value: asString(fieldConfig.lang),
          className: 'view-footer-custom-group-dropdown',
          closeOverlaysOnOpen: false,
          portalZIndex: 1500,
          getButtonLabel: ({ selectedItem }) => {
            if (!asString(fieldConfig.lang).trim()) {
              return inferredLang ? `Auto (${inferredLang})` : 'Auto';
            }
            if (selectedItem && selectedItem.label) return selectedItem.label;
            return inferredLang ? `Auto (${inferredLang})` : 'Auto';
          },
          onChange: (nextLang) => {
            syncFieldDraft(field.fieldKey, { lang: normalizeLangTag(nextLang) });
          },
        });

        const rateDropdown = createDropdown({
          items: rateItems,
          value: (fieldConfig.rate == null || fieldConfig.rate === '') ? '' : String(fieldConfig.rate),
          className: 'view-footer-custom-group-dropdown',
          closeOverlaysOnOpen: false,
          portalZIndex: 1500,
          getButtonLabel: ({ selectedItem }) => selectedItem?.label || 'Auto',
          onChange: (nextRate) => {
            const trimmed = asString(nextRate).trim();
            syncFieldDraft(field.fieldKey, {
              rate: trimmed ? Number(trimmed) : '',
            });
          },
        });

        const resetBtn = el('button', { className: 'btn small', text: 'Reset' });
        resetBtn.type = 'button';
        resetBtn.addEventListener('click', () => {
          delete draft.fields[field.fieldKey];
          renderRows();
        });

        const testBtn = el('button', { className: 'btn small', text: 'Test' });
        testBtn.type = 'button';
        testBtn.title = field.sampleText ? `Speak "${field.sampleText}"` : `Test ${field.label}`;
        testBtn.addEventListener('click', () => {
          const current = getFieldDraft(field.fieldKey);
          const sampleText = field.sampleText || field.fieldKey;
          if (!sampleText) return;
          speak(sampleText, {
            fieldKey: field.fieldKey,
            collectionKey: field.collectionKey,
            lang: current.lang || undefined,
            rate: (current.rate == null || current.rate === '') ? undefined : current.rate,
          });
        });

        row.append(
          el('div', { className: 'view-footer-custom-action-label', text: field.label }),
          (() => {
            const wrap = el('div', { className: 'view-footer-action-field' });
            wrap.appendChild(langDropdown);
            return wrap;
          })(),
          (() => {
            const wrap = el('div', { className: 'view-footer-action-field' });
            wrap.appendChild(rateDropdown);
            return wrap;
          })(),
          testBtn,
          resetBtn,
        );
        table.appendChild(row);
      }

      if (!normalizedFields.length) {
        table.appendChild(el('div', { className: 'hint', text: 'No speakable entry fields found.' }));
      }
    }

    let closed = false;
    function close(result = null) {
      if (closed) return;
      closed = true;
      try { document.removeEventListener('keydown', onKeyDown, true); } catch (e) {}
      try {
        if (window.speechSynthesis && voicesChangedHandler && window.speechSynthesis.onvoiceschanged === voicesChangedHandler) {
          window.speechSynthesis.onvoiceschanged = null;
        }
      } catch (e) {}
      try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {}
      try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {}
      try { if (prevFocus && prevFocus.focus) prevFocus.focus(); } catch (e) {}
      resolve(result);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      }
    }

    cancelBtn.addEventListener('click', () => close(null));
    saveBtn.addEventListener('click', () => close(cleanupSpeechConfig(draft)));
    backdrop.addEventListener('click', () => close(null));

    renderRows();
    try {
      if (window.speechSynthesis) {
        voicesChangedHandler = () => {
          currentVoices = window.speechSynthesis?.getVoices?.() || [];
          renderRows();
        };
        window.speechSynthesis.onvoiceschanged = voicesChangedHandler;
      }
    } catch (e) {}
    document.addEventListener('keydown', onKeyDown, true);
    try { dialog.focus(); } catch (e) {}
  });
}
