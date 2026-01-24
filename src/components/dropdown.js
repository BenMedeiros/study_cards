/**
 * Create a custom styled dropdown that replaces native <select>
 * @param {Object} options
 * @param {Array<{value: string, label: string}>} options.items - Dropdown items
 * @param {string} options.value - Currently selected value
 * @param {Function} options.onChange - Callback when selection changes
 * @param {string} options.className - Optional CSS class
 * @returns {HTMLElement} Custom dropdown element
 */
export function createDropdown({ items, value, onChange, className = '' }) {
  const container = document.createElement('div');
  container.className = `custom-dropdown ${className}`;
  container.style.position = 'relative';
  
  const selected = items.find(item => item.value === value) || items[0];
  
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'custom-dropdown-button';
  button.textContent = selected?.label || '';
  
  const menu = document.createElement('div');
  menu.className = 'custom-dropdown-menu';
  menu.style.display = 'none';
  menu.style.position = 'fixed';
  menu.style.left = '0px';
  menu.style.top = '0px';
  menu.style.zIndex = '1000';

  const isOpen = () => menu.style.display === 'block';

  function onCloseOverlaysEvent() {
    if (isOpen()) closeMenu({ focusButton: true });
  }

  function closeMenu({ focusButton = false } = {}) {
    menu.style.display = 'none';
    container.classList.remove('open');
    window.removeEventListener('resize', positionMenu);
    window.removeEventListener('scroll', positionMenu);
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
    document.dispatchEvent(new CustomEvent('ui:closeOverlays'));

    const open = isOpen();
    
    // Close all other dropdowns
    document.querySelectorAll('.custom-dropdown-menu').forEach(m => {
      m.style.display = 'none';
    });
    document.querySelectorAll('.custom-dropdown').forEach(d => {
      d.classList.remove('open');
    });
    
    // Toggle this dropdown
    if (!open) {
      menu.style.display = 'block';
      container.classList.add('open');
      positionMenu();
      window.addEventListener('resize', positionMenu);
      window.addEventListener('scroll', positionMenu, { passive: true });
      document.addEventListener('ui:closeOverlays', onCloseOverlaysEvent);
    } else {
      closeMenu();
    }
  });

  function positionMenu() {
    const docW = window.innerWidth;
    const docH = window.innerHeight;
    const btnRect = button.getBoundingClientRect();

    // Temporarily show the menu invisibly to measure it
    const prevDisplay = menu.style.display;
    const prevVisibility = menu.style.visibility;
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    const menuRect = menu.getBoundingClientRect();

    // Horizontal: prefer right-aligning menu to the button (so menu's right edge matches button's right).
    let desiredLeft = btnRect.right - menuRect.width;
    // If that would put it off the left edge, try left-align to button
    if (desiredLeft < 0) desiredLeft = btnRect.left;
    // If still overflows right edge, clamp within viewport
    if (desiredLeft + menuRect.width > docW) desiredLeft = Math.max(0, docW - menuRect.width);
    menu.style.left = `${Math.round(desiredLeft)}px`;

    // Vertical: open downward if there's space, otherwise open upward
    // Vertical: open downward if there's space, otherwise open upward
    if (btnRect.bottom + menuRect.height > docH && btnRect.top - menuRect.height >= 0) {
      // Open upward: position top so menu's bottom aligns with button's top
      const upwardTop = btnRect.top - menuRect.height;
      menu.style.top = `${Math.round(upwardTop)}px`;
    } else {
      // Open downward: position top at button bottom
      menu.style.top = `${Math.round(btnRect.bottom)}px`;
    }

    // Ensure menu is at least as wide as the button
    menu.style.minWidth = `${Math.max(Math.round(btnRect.width), Math.round(menuRect.width))}px`;

    // Restore visibility to previous state
    menu.style.display = prevDisplay;
    menu.style.visibility = prevVisibility;
  }
  
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
