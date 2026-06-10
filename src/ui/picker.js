// Visual Picker Client script injected into the proxy iframe page

(function() {
  // Add highlight style
  const style = document.createElement('style');
  style.innerHTML = `
    .scrapi-hovered {
      outline: 2px dashed #2563eb !important;
      background-color: rgba(37, 99, 235, 0.15) !important;
      transition: all 0.1s ease-in-out;
      cursor: pointer !important;
    }
    .scrapi-selected {
      outline: 3px solid #16a34a !important;
      background-color: rgba(22, 163, 74, 0.2) !important;
    }
  `;
  document.head.appendChild(style);

  // Generate a minimal unique CSS selector for an element
  function generateCssSelector(el) {
    if (!(el instanceof Element)) return '';
    
    // If element has ID, that is unique enough
    if (el.id) {
      return `#${el.id}`;
    }

    const path = [];
    while (el && el.nodeType === Node.ELEMENT_NODE) {
      let selector = el.nodeName.toLowerCase();
      
      // If it has a unique class, add it
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).filter(c => c && !c.startsWith('scrapi-'));
        if (classes.length > 0) {
          selector += '.' + classes.join('.');
        }
      }

      // Find index among siblings of same tag
      let sibling = el.previousElementSibling;
      let nth = 1;
      while (sibling) {
        if (sibling.nodeName === el.nodeName) {
          nth++;
        }
        sibling = sibling.previousElementSibling;
      }
      
      let parent = el.parentElement;
      if (parent) {
        let siblingsWithSameSelector = parent.querySelectorAll(selector);
        if (siblingsWithSameSelector.length > 1) {
          selector += `:nth-of-type(${nth})`;
        }
      }

      path.unshift(selector);
      el = el.parentElement;
    }
    
    return path.join(' > ');
  }

  let currentHovered = null;

  // Intercept hover
  document.addEventListener('mouseover', (e) => {
    e.stopPropagation();
    if (currentHovered) {
      currentHovered.classList.remove('scrapi-hovered');
    }
    const target = e.target;
    // Don't select our own wrapper/styles
    if (target.tagName === 'BODY' || target.tagName === 'HTML') return;
    
    currentHovered = target;
    currentHovered.classList.add('scrapi-hovered');
  }, true);

  document.addEventListener('mouseout', (e) => {
    e.stopPropagation();
    if (currentHovered) {
      currentHovered.classList.remove('scrapi-hovered');
      currentHovered = null;
    }
  }, true);

  // Intercept click
  document.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const target = e.target;
    if (target.tagName === 'BODY' || target.tagName === 'HTML') return;

    // Clear previous selected visual status
    document.querySelectorAll('.scrapi-selected').forEach(el => {
      el.classList.remove('scrapi-selected');
    });

    target.classList.add('scrapi-selected');

    // Generate selector
    const selector = generateCssSelector(target);

    // Send selector details to parent window (React UI)
    window.parent.postMessage({
      type: 'ELEMENT_SELECTED',
      selector: selector,
      tagName: target.tagName.toLowerCase(),
      textSnippet: target.innerText ? target.innerText.substring(0, 100).trim() : ''
    }, '*');
  }, true);

  console.log('🕷️ Scrapi Element Picker Injected & Active!');
})();
