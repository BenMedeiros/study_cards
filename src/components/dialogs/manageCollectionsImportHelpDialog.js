// Rich HTML help dialog for import formats
export async function showManageCollectionsImportHelpDialog() {
  // Close any other overlays
  try { document.dispatchEvent(new CustomEvent('ui:closeOverlays')); } catch (e) {}

  return new Promise((resolve) => {
    let done = false;

    const backdrop = document.createElement('div');
    backdrop.className = 'confirm-backdrop';

    const dialog = document.createElement('div');
    dialog.className = 'confirm-dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-label', 'Import Help — Accepted Formats');
    dialog.tabIndex = -1;

    const header = document.createElement('div');
    header.className = 'confirm-header';
    const titleEl = document.createElement('div');
    titleEl.className = 'confirm-title';
    titleEl.textContent = 'Import Help — Accepted Formats';
    header.appendChild(titleEl);

    const body = document.createElement('div');
    body.className = 'confirm-body';

    // Build rich content
    const sections = [];

    // Metadata section
    const metaH = document.createElement('h3'); metaH.textContent = 'Metadata';
    const metaP = document.createElement('p'); metaP.textContent = 'Metadata updates change collection-level properties such as name, description, category, and entry_key. To update metadata only, provide a metadata object.';
    const metaPre = document.createElement('pre'); metaPre.textContent = JSON.stringify({ metadata: { name: 'My Collection', description: 'Short description', entry_key: 'id' } }, null, 2);
    sections.push(metaH, metaP, metaPre);

    // Schema section
    const schemaH = document.createElement('h3'); schemaH.textContent = 'Schema';
    const schemaP = document.createElement('p'); schemaP.textContent = 'Schema updates must be explicit. Provide a top-level schema array or metadata.schema array.';
    const schemaPre1 = document.createElement('pre'); schemaPre1.textContent = JSON.stringify({ schema: [{ key: 'kanji', type: 'string' }, { key: 'reading', type: 'string' }] }, null, 2);
    const schemaPre2 = document.createElement('pre'); schemaPre2.textContent = JSON.stringify({ metadata: { schema: [{ key: 'kanji', type: 'string' }] } }, null, 2);
    sections.push(schemaH, schemaP, schemaPre1, schemaPre2);

    // Entries section
    const entriesH = document.createElement('h3'); entriesH.textContent = 'Entries';
    const entriesP = document.createElement('p'); entriesP.textContent = 'Entry updates are flexible. The following shapes are accepted and will be normalized.';
    const entryPre1 = document.createElement('pre'); entryPre1.textContent = JSON.stringify({ kanji: '日', reading: 'にち', meaning: 'sun' }, null, 2);
    const entryPre2 = document.createElement('pre'); entryPre2.textContent = JSON.stringify([{ kanji: '日' }, { kanji: '本' }], null, 2);
    const entryPre3 = document.createElement('pre'); entryPre3.textContent = JSON.stringify({ entries: { kanji: '日' } }, null, 2);
    const entryList = document.createElement('p'); entryList.textContent = 'Accepted explicit keys: entries, entry, sentences, paragraphs, items, cards (single object will be wrapped into array).';
    sections.push(entriesH, entriesP, entryPre1, entryPre2, entryPre3, entryList);

    // Full collection
    const fullH = document.createElement('h3'); fullH.textContent = 'Full collection';
    const fullP = document.createElement('p'); fullP.textContent = 'You may pass a full collection object with metadata and an entries array.';
    const fullPre = document.createElement('pre'); fullPre.textContent = JSON.stringify({ metadata: { name: 'My set' }, entries: [{ kanji: '日' }] }, null, 2);
    sections.push(fullH, fullP, fullPre);

    // Notes
    const notesH = document.createElement('h3'); notesH.textContent = 'Notes';
    const notesUl = document.createElement('ul');
    const li1 = document.createElement('li'); li1.textContent = 'A bare array is interpreted as an entries array and will be assigned to the detected array key (usually entries or sentences).';
    const li2 = document.createElement('li'); li2.textContent = 'Schema-only updates will be ignored unless you supply schema or metadata.schema explicitly.';
    const li3 = document.createElement('li'); li3.textContent = 'When in doubt, use the entries key for entry lists and metadata.schema for schema edits.';
    notesUl.append(li1, li2, li3);
    sections.push(notesH, notesUl);

    sections.forEach(s => body.appendChild(s));

    const footer = document.createElement('div'); footer.className = 'confirm-footer';
    const closeBtn = document.createElement('button'); closeBtn.className = 'btn'; closeBtn.type = 'button'; closeBtn.textContent = 'Close';
    footer.appendChild(closeBtn);

    dialog.append(header, body, footer);

    let _prevActive = null;

    function finish() {
      if (done) return; done = true;
      try { dialog.classList && dialog.classList.remove('open'); backdrop.classList && backdrop.classList.remove('show'); } catch (e) {}
      const cleanup = () => { try { if (dialog.parentNode) dialog.parentNode.removeChild(dialog); } catch (e) {} try { if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop); } catch (e) {} };
      try { dialog.addEventListener('transitionend', cleanup); } catch (e) {}
      setTimeout(cleanup, 220);
      try { if (_prevActive && _prevActive.focus) _prevActive.focus(); } catch (e) {}
      try { document.removeEventListener('keydown', onKeyDown); } catch (e) {}
      resolve(true);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') { e.preventDefault(); finish(); return; }
      if (e.key !== 'Tab') return;
      const sel = 'a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])';
      const focusables = Array.from(dialog.querySelectorAll(sel)).filter(n => n.offsetParent !== null);
      if (!focusables.length) { e.preventDefault(); return; }
      const first = focusables[0]; const last = focusables[focusables.length - 1];
      if (e.shiftKey) { if (document.activeElement === first) { e.preventDefault(); last.focus(); } }
      else { if (document.activeElement === last) { e.preventDefault(); first.focus(); } }
    }

    backdrop.addEventListener('click', finish);
    closeBtn.addEventListener('click', finish);

    const mount = document.getElementById('shell-root') || document.getElementById('app') || document.body;
    _prevActive = document.activeElement;
    mount.appendChild(backdrop); mount.appendChild(dialog);

    dialog.style.position = 'fixed'; dialog.style.left = '50%'; dialog.style.top = '50%'; dialog.style.transform = 'translate(-50%, -50%)';
    requestAnimationFrame(() => { try { backdrop.classList && backdrop.classList.add('show'); dialog.classList && dialog.classList.add('open'); } catch (e) {} try { closeBtn.focus(); } catch (e) { try { dialog.focus(); } catch (e2) {} } });
    document.addEventListener('keydown', onKeyDown);
  });
}
