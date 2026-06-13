// Visual Picker Client script injected into the proxy iframe page

(function() {
  // Add highlight and tooltip styles
  const style = document.createElement('style');
  style.innerHTML = `
    .scrapi-hovered {
      outline: 2px dashed #2563eb !important;
      background-color: rgba(37, 99, 235, 0.15) !important;
      transition: outline 0.1s ease-in-out;
      cursor: pointer !important;
    }
    .scrapi-selected {
      outline: 3px solid #16a34a !important;
      background-color: rgba(22, 163, 74, 0.2) !important;
    }
  `;
  document.head.appendChild(style);

  // Create a floating selector tooltip
  let tooltip = document.createElement('div');
  tooltip.id = 'scrapi-tooltip';
  Object.assign(tooltip.style, {
    position: 'fixed',
    background: '#0f172a',
    color: '#38bdf8',
    border: '1px solid #3b82f6',
    padding: '4px 8px',
    borderRadius: '6px',
    fontSize: '10px',
    fontFamily: 'monospace',
    zIndex: '9999999',
    pointerEvents: 'none',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.5)',
    display: 'none',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
    maxWidth: '300px',
    overflow: 'hidden'
  });
  document.body.appendChild(tooltip);

  // Generate a minimal unique CSS selector for an element
  function generateCssSelector(el) {
    if (!(el instanceof Element)) return '';
    if (el.__scrapi_selector__) {
      return el.__scrapi_selector__;
    }
    
    if (el.id) {
      el.__scrapi_selector__ = `#${el.id}`;
      return `#${el.id}`;
    }

    const path = [];
    let current = el;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let selector = current.nodeName.toLowerCase();
      
      const classAttr = current.getAttribute('class');
      if (classAttr && typeof classAttr === 'string') {
        const classes = classAttr.trim()
          .split(/\s+/)
          .filter(c => c && !c.startsWith('scrapi-') && !c.includes(':') && !c.includes('['));
        if (classes.length > 0) {
          selector += '.' + classes[0]; // Minimal selector: use first class
        }
      }

      let sibling = current.previousElementSibling;
      let nth = 1;
      while (sibling) {
        if (sibling.nodeName === current.nodeName) {
          nth++;
        }
        sibling = sibling.previousElementSibling;
      }
      
      let parent = current.parentElement;
      if (parent) {
        try {
          let siblingsWithSameSelector = parent.querySelectorAll(selector);
          if (siblingsWithSameSelector.length > 1) {
            selector += `:nth-of-type(${nth})`;
          }
        } catch (e) {
          selector += `:nth-of-type(${nth})`;
        }
      }

      path.unshift(selector);
      current = current.parentElement;
    }
    
    const finalSelector = path.join(' > ');
    el.__scrapi_selector__ = finalSelector;
    return finalSelector;
  }

  let currentHovered = null;
  let hoverTimeout = null;

  // Intercept hover with a 50ms debounce/throttle to avoid heavy computation on fast sweeps
  document.addEventListener('mouseover', (e) => {
    e.stopPropagation();
    const target = e.target;
    if (target.tagName === 'BODY' || target.tagName === 'HTML' || target.id === 'scrapi-tooltip') return;
    
    if (currentHovered) {
      currentHovered.classList.remove('scrapi-hovered');
    }
    
    currentHovered = target;
    currentHovered.classList.add('scrapi-hovered');

    if (hoverTimeout) clearTimeout(hoverTimeout);
    
    hoverTimeout = setTimeout(() => {
      if (currentHovered !== target) return;
      
      // Update tooltip
      const selector = generateCssSelector(currentHovered);
      const rect = currentHovered.getBoundingClientRect();
      
      tooltip.innerText = selector;
      tooltip.style.display = 'block';
      
      // Position tooltip above element or at cursor if top space is limited
      const topPos = rect.top - 26;
      tooltip.style.top = `${topPos > 5 ? topPos : rect.top + rect.height + 5}px`;
      tooltip.style.left = `${rect.left + 5}px`;
    }, 50);
  }, true);

  document.addEventListener('mouseout', (e) => {
    e.stopPropagation();
    if (hoverTimeout) clearTimeout(hoverTimeout);
    if (currentHovered) {
      currentHovered.classList.remove('scrapi-hovered');
      currentHovered = null;
    }
    tooltip.style.display = 'none';
  }, true);

  // Intercept click
  document.addEventListener('click', (e) => {
    const target = e.target;

    // Alt-click or Cmd-click on link: trigger navigation in parent proxy console
    const linkEl = target.closest('a');
    if ((e.altKey || e.metaKey || e.ctrlKey) && linkEl) {
      e.preventDefault();
      e.stopPropagation();
      const href = linkEl.getAttribute('href');
      if (href) {
        try {
          const absoluteUrl = new URL(href, window.location.href).href;
          window.parent.postMessage({
            type: 'NAVIGATE_TO_URL',
            url: absoluteUrl
          }, '*');
        } catch (err) {
          console.error('Failed to resolve Alt-Click link navigation:', err);
        }
      }
      return;
    }

    // Standard click: select element selector
    e.preventDefault();
    e.stopPropagation();

    if (target.tagName === 'BODY' || target.tagName === 'HTML' || target.id === 'scrapi-tooltip') return;

    // Clear previous selected visual status
    document.querySelectorAll('.scrapi-selected').forEach(el => {
      el.classList.remove('scrapi-selected');
    });

    target.classList.add('scrapi-selected');

    // Generate selector
    const selector = generateCssSelector(target);

    const classAttr = target.getAttribute('class') || '';
    const classesList = classAttr.trim().split(/\s+/).filter(c => c && !c.startsWith('scrapi-'));

    // Send selector details to parent window (React UI)
    window.parent.postMessage({
      type: 'ELEMENT_SELECTED',
      selector: selector,
      tagName: target.tagName.toLowerCase(),
      textSnippet: target.innerText ? target.innerText.substring(0, 100).trim() : '',
      classes: classesList,
      parentTagName: target.parentElement ? target.parentElement.tagName.toLowerCase() : null
    }, '*');
  }, true);

  console.log('🕷️ Scrapi Element Picker Injected & Active!');
})();
