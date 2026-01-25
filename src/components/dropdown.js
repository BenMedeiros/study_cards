/**
 * Create a custom styled dropdown that replaces native <select>
 * @param {Object} options
 * @param {Array<{value: string, label: string}>} options.items - Dropdown items
 * @param {string} options.value - Currently selected value
 * @param {Function} options.onChange - Callback when selection changes
 * @param {string} options.className - Optional CSS class
 * @param {boolean} options.closeOverlaysOnOpen - If true, dispatches ui:closeOverlays before opening.
 * @returns {HTMLElement} Custom dropdown element
 */
export function createDropdown({ items, value, onChange, className = '', closeOverlaysOnOpen = true }) {
  const container = document.createElement('div');
  container.className = `custom-dropdown ${className}`;
  
  const selected = items.find(item => item.value === value) || items[0];
  
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-dropdown-button';
  button.textContent = selected?.label || '';
  
  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';

  const isOpen = () => container.classList.contains('open');

  function onCloseOverlaysEvent() {
    if (isOpen()) closeMenu({ focusButton: true });
  }

  function closeMenu({ focusButton = false } = {}) {
    container.classList.remove('open');
    container.classList.remove('align-right');
    document.removeEventListener('ui:closeOverlays', onCloseOverlaysEvent);
    if (focusButton) button.focus();
  }
  
  for (const item of items) {
    const option = document.createElement('div');
    option.className = 'custom-dropdown-option';
    if (item.value === value) {
      option.classList.add('selected');
    }
    option.textContent = item.label;
    option.dataset.value = item.value;
    
    option.addEventListener('click', () => {
      // Keep internal value in sync for keyboard navigation
      value = item.value;

      // Update selected state
      menu.querySelectorAll('.custom-dropdown-option').forEach(opt => {
        opt.classList.remove('selected');
      });
      option.classList.add('selected');
      
      // Update button text
      button.textContent = item.label;
      
      // Close menu
      closeMenu();
      
      // Trigger callback
      if (onChange) {
        onChange(item.value);
      }
    });
    
    menu.append(option);
  }
  
  button.addEventListener('click', (e) => {
    e.stopPropagation();
    // Close other overlays (e.g., autoplay settings) before opening.
    // Some dropdowns live inside overlays (e.g. shell settings) and should not close them.
    if (closeOverlaysOnOpen) {
      document.dispatchEvent(new CustomEvent('ui:closeOverlays'));
    }

    const open = isOpen();
    
    // Close all other dropdowns and clear their alignment
    document.querySelectorAll('.custom-dropdown.open').forEach(d => {
      if (d !== container) {
        d.classList.remove('open');
        d.classList.remove('align-right');
      }
    });

    // Toggle this dropdown
    if (!open) {
      container.classList.add('open');
      document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);

      // After opening, measure the menu and align to the right if it would overflow the viewport.
      // Use a microtask to ensure styles are applied and menu is rendered.
      Promise.resolve().then(() => {
        const rect = menu.getBoundingClientRect();
        const margin = 8; // keep a small gap from the viewport edge
        if (rect.right > (window.innerWidth - margin) || rect.left < 0) {
          container.classList.add('align-right');
        } else {
          container.classList.remove('align-right');
        }
      });
    } else {
      closeMenu();
    }
  });
  
  // Close dropdown when clicking outside
  const closeOnClickOutside = (e) => {
    if (!container.contains(e.target) && !menu.contains(e.target)) {
      closeMenu();
    }
  };
  
  // Attach listener when dropdown is added to DOM
  setTimeout(() => {
    document.addEventListener('click', closeOnClickOutside);
  }, 0);
  
  // Keyboard navigation
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      button.click();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const currentIndex = items.findIndex(item => item.value === value);
      const nextIndex = e.key === 'ArrowDown' 
        ? Math.min(currentIndex + 1, items.length - 1)
        : Math.max(currentIndex - 1, 0);
      
      const nextItem = items[nextIndex];
      if (nextItem && onChange) {
        onChange(nextItem.value);
        button.textContent = nextItem.label;
        
        // Update selected state
        menu.querySelectorAll('.custom-dropdown-option').forEach((opt, i) => {
          opt.classList.toggle('selected', i === nextIndex);
        });
      }
    }
  });
  
  container.append(button, menu);
  return container;
}
