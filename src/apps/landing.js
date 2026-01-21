export function renderLanding({ store, onNavigate }) {
  const el = document.createElement('div');
  el.id = 'landing-root';

  const card = document.createElement('div');
  card.className = 'card';
  card.id = 'landing-card';

  const active = store.getActiveCollection();

  const h2 = document.createElement('h2');
  h2.id = 'landing-title';
  h2.textContent = 'Choose a tool';

  const p = document.createElement('p');
  p.className = 'hint';
  p.id = 'landing-active-collection';
  p.append('Active collection: ');

  const strong = document.createElement('strong');
  strong.id = 'landing-active-collection-name';
  strong.textContent = active?.metadata?.name ?? 'None';
  p.append(strong);

  const grid = document.createElement('div');
  grid.className = 'grid';
  grid.id = 'landing-grid';

    const mkTool = ({ idPrefix, title, hint, goTo }) => {
      const toolCard = document.createElement('div');
      toolCard.className = 'card';
      toolCard.id = `${idPrefix}-card`;

      const h3 = document.createElement('h3');
      h3.id = `${idPrefix}-title`;
      h3.textContent = title;

      const ph = document.createElement('p');
      ph.className = 'hint';
      ph.id = `${idPrefix}-hint`;
      ph.textContent = hint;

      const btn = document.createElement('button');
      btn.className = 'button';
      btn.id = `${idPrefix}-open`;
      btn.name = `${idPrefix}-open`;
      btn.textContent = 'Open';
      btn.setAttribute('data-go', goTo);

      toolCard.append(h3, ph, btn);
      return toolCard;
    };

    grid.append(
      mkTool({ idPrefix: 'landing-flashcards', title: 'Flashcards', hint: 'Browse and review all fields.', goTo: '/flashcards' }),
      mkTool({ idPrefix: 'landing-qa-cards', title: 'QA Cards', hint: 'Type answers with romaji conversion.', goTo: '/qa-cards' }),
      mkTool({ idPrefix: 'landing-data', title: 'Data', hint: 'View collection entries in table format.', goTo: '/data' })
    );

  // If the active collection is Japanese, add Kanji Study to the landing grid
  const activeCategory = active?.metadata?.category || '';
  if (activeCategory.toLowerCase() === 'japanese') {
    grid.appendChild(mkTool({ idPrefix: 'landing-kanji', title: 'Kanji Study', hint: 'Study kanji (centered, reading bottom-left, meaning bottom-right).', goTo: '/kanji' }));
  }

  card.append(h2, p, grid);

  card.addEventListener('click', (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const path = target.getAttribute('data-go');
    if (!path) return;
    onNavigate(path);
  });

  el.append(card);
  return el;
}
