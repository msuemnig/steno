/**
 * Selector generation logic.
 * Given a DOM element, returns the best available stable CSS selector.
 */
const Recorder = (() => {
  /**
   * Generate the best selector for an element.
   * Priority: #id > [name] > [data-qa] > positional fallback.
   * Returns { selector, fragile } where fragile=true means positional fallback was used.
   */
  function getSelector(el) {
    // 1. ID
    if (el.id) {
      return { selector: `#${CSS.escape(el.id)}`, fragile: false };
    }

    // 2. name attribute
    if (el.name) {
      const sel = `${el.tagName.toLowerCase()}[name="${el.name}"]`;
      if (document.querySelectorAll(sel).length === 1) {
        return { selector: sel, fragile: false };
      }
      // If name isn't unique, scope it to the closest form
      const form = el.closest('form');
      if (form) {
        const formIndex = Array.from(document.querySelectorAll('form')).indexOf(form);
        const scoped = `form:nth-of-type(${formIndex + 1}) ${el.tagName.toLowerCase()}[name="${el.name}"]`;
        if (document.querySelectorAll(scoped).length === 1) {
          return { selector: scoped, fragile: false };
        }
      }
    }

    // 3. data-qa attribute
    if (el.dataset.qa) {
      const sel = `[data-qa="${el.dataset.qa}"]`;
      if (document.querySelectorAll(sel).length === 1) {
        return { selector: sel, fragile: false };
      }
    }

    // 4. Positional fallback
    const sel = buildPositionalSelector(el);
    return { selector: sel, fragile: true };
  }

  function buildPositionalSelector(el) {
    const parts = [];
    let current = el;
    while (current && current !== document.body) {
      const tag = current.tagName.toLowerCase();
      const parent = current.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (c) => c.tagName === current.tagName
        );
        if (siblings.length > 1) {
          const index = siblings.indexOf(current) + 1;
          parts.unshift(`${tag}:nth-of-type(${index})`);
        } else {
          parts.unshift(tag);
        }
      } else {
        parts.unshift(tag);
      }
      current = parent;
    }
    return parts.join(' > ');
  }

  /**
   * Get a human-readable label for a form element.
   */
  function getLabel(el) {
    // Explicit <label for="...">
    if (el.id) {
      const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (label) return label.textContent.trim();
    }
    // Wrapping <label>
    const wrapping = el.closest('label');
    if (wrapping) return wrapping.textContent.trim();
    // placeholder
    if (el.placeholder) return el.placeholder;
    // aria-label
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    // name as last resort
    if (el.name) return el.name;
    return '';
  }

  /**
   * Determine the logical field type.
   */
  function getFieldType(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return 'select';
    if (tag === 'textarea') return 'textarea';
    if (tag === 'input') {
      const type = (el.type || 'text').toLowerCase();
      if (['checkbox', 'radio', 'date', 'time', 'datetime-local', 'color', 'range', 'file'].includes(type)) {
        return type;
      }
      return 'text';
    }
    return 'text';
  }

  /**
   * Get the current value of a form element.
   */
  function getValue(el) {
    const type = getFieldType(el);
    if (type === 'checkbox') return el.checked;
    if (type === 'radio') return el.value;
    return el.value;
  }

  /**
   * Get a human-readable label for a clickable element (button, link, etc.).
   */
  function getClickLabel(el) {
    const text = (el.textContent || '').trim();
    if (text) return text.length > 60 ? text.slice(0, 60) : text;
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.title) return el.title;
    if (el.value) return el.value;
    return el.tagName.toLowerCase();
  }

  return { getSelector, getLabel, getFieldType, getValue, getClickLabel };
})();
