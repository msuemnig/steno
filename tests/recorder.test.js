/**
 * Tests for services/recorder.js — Recorder (selector generation + label/type/value utils)
 *
 * Recorder is an IIFE that returns { getSelector, getLabel, getFieldType, getValue, getClickLabel }.
 * We evaluate the source to get the Recorder object, then create DOM elements in jsdom to test it.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const recorderSrc = readFileSync(join(__dirname, '..', 'services', 'recorder.js'), 'utf-8');
const _evalRecorder = new Function(recorderSrc + '\nreturn Recorder;');
const Recorder = _evalRecorder();

describe('Recorder', () => {
  afterEach(() => {
    // Clean up DOM between tests
    document.body.innerHTML = '';
  });

  // ──────────────────────────────────────────────────────────────
  // getSelector
  // ──────────────────────────────────────────────────────────────

  describe('getSelector', () => {
    it('generates ID selector when element has id', () => {
      document.body.innerHTML = '<input id="email" type="text">';
      const el = document.getElementById('email');
      const result = Recorder.getSelector(el);

      expect(result.selector).toBe('#email');
      expect(result.fragile).toBe(false);
    });

    it('escapes special characters in id', () => {
      document.body.innerHTML = '<input id="field.name" type="text">';
      const el = document.getElementById('field.name');
      const result = Recorder.getSelector(el);

      // CSS.escape should handle the dot
      expect(result.selector).toContain('field');
      expect(result.fragile).toBe(false);
    });

    it('generates name selector when element has name and no id', () => {
      document.body.innerHTML = '<input name="username" type="text">';
      const el = document.querySelector('[name="username"]');
      const result = Recorder.getSelector(el);

      expect(result.selector).toBe('input[name="username"]');
      expect(result.fragile).toBe(false);
    });

    it('generates data-qa selector when element has data-qa and no id/name', () => {
      document.body.innerHTML = '<input data-qa="login-button" type="text">';
      const el = document.querySelector('[data-qa]');
      const result = Recorder.getSelector(el);

      expect(result.selector).toBe('[data-qa="login-button"]');
      expect(result.fragile).toBe(false);
    });

    it('generates positional/nth-of-type selector as fallback', () => {
      document.body.innerHTML = `
        <div>
          <input type="text">
          <input type="text">
        </div>
      `;
      const inputs = document.querySelectorAll('input');
      const result = Recorder.getSelector(inputs[1]); // second input, no id/name/data-qa

      expect(result.fragile).toBe(true);
      expect(result.selector).toContain('nth-of-type');
    });

    it('prefers ID over name', () => {
      document.body.innerHTML = '<input id="myId" name="myName" type="text">';
      const el = document.querySelector('input');
      const result = Recorder.getSelector(el);

      expect(result.selector).toBe('#myId');
    });

    it('prefers name over data-qa when no id', () => {
      document.body.innerHTML = '<input name="myName" data-qa="myQa" type="text">';
      const el = document.querySelector('input');
      const result = Recorder.getSelector(el);

      expect(result.selector).toBe('input[name="myName"]');
    });

    it('handles elements inside forms with duplicate names by scoping', () => {
      document.body.innerHTML = `
        <form>
          <input name="email" type="text">
        </form>
        <form>
          <input name="email" type="text">
        </form>
      `;
      const secondInput = document.querySelectorAll('input[name="email"]')[1];
      const result = Recorder.getSelector(secondInput);

      // The name "email" is not unique, so it should scope to the form
      // form:nth-of-type(2) input[name="email"]
      expect(result.fragile).toBe(false);
      expect(result.selector).toContain('form:nth-of-type(2)');
      expect(result.selector).toContain('[name="email"]');
    });

    it('falls back to positional when name is not unique and not in a form', () => {
      document.body.innerHTML = `
        <div>
          <input name="field" type="text">
          <input name="field" type="text">
        </div>
      `;
      const secondInput = document.querySelectorAll('input[name="field"]')[1];
      const result = Recorder.getSelector(secondInput);

      // name is not unique, no form to scope to, falls through name check
      // data-qa doesn't exist, so goes to positional fallback
      expect(result.fragile).toBe(true);
    });

    it('generates non-fragile selector for unique name inside form', () => {
      document.body.innerHTML = `
        <form>
          <input name="unique-field" type="text">
        </form>
      `;
      const el = document.querySelector('input');
      const result = Recorder.getSelector(el);

      expect(result.selector).toBe('input[name="unique-field"]');
      expect(result.fragile).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getLabel
  // ──────────────────────────────────────────────────────────────

  describe('getLabel', () => {
    it('returns label text from <label for="...">', () => {
      document.body.innerHTML = `
        <label for="email">Email Address</label>
        <input id="email" type="text">
      `;
      const el = document.getElementById('email');
      expect(Recorder.getLabel(el)).toBe('Email Address');
    });

    it('returns text from wrapping <label>', () => {
      document.body.innerHTML = `
        <label>Username <input type="text"></label>
      `;
      const el = document.querySelector('input');
      // textContent of the label includes "Username" and whatever the input adds
      expect(Recorder.getLabel(el)).toContain('Username');
    });

    it('returns placeholder when no label', () => {
      document.body.innerHTML = '<input type="text" placeholder="Enter email">';
      const el = document.querySelector('input');
      expect(Recorder.getLabel(el)).toBe('Enter email');
    });

    it('returns aria-label when no label or placeholder', () => {
      document.body.innerHTML = '<input type="text" aria-label="Search">';
      const el = document.querySelector('input');
      expect(Recorder.getLabel(el)).toBe('Search');
    });

    it('returns name as last resort', () => {
      document.body.innerHTML = '<input type="text" name="zipcode">';
      const el = document.querySelector('input');
      expect(Recorder.getLabel(el)).toBe('zipcode');
    });

    it('returns empty string when nothing available', () => {
      document.body.innerHTML = '<input type="text">';
      const el = document.querySelector('input');
      expect(Recorder.getLabel(el)).toBe('');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getFieldType
  // ──────────────────────────────────────────────────────────────

  describe('getFieldType', () => {
    it('returns "select" for <select>', () => {
      document.body.innerHTML = '<select><option>A</option></select>';
      expect(Recorder.getFieldType(document.querySelector('select'))).toBe('select');
    });

    it('returns "textarea" for <textarea>', () => {
      document.body.innerHTML = '<textarea></textarea>';
      expect(Recorder.getFieldType(document.querySelector('textarea'))).toBe('textarea');
    });

    it('returns "checkbox" for input[type=checkbox]', () => {
      document.body.innerHTML = '<input type="checkbox">';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('checkbox');
    });

    it('returns "radio" for input[type=radio]', () => {
      document.body.innerHTML = '<input type="radio">';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('radio');
    });

    it('returns "text" for input[type=text]', () => {
      document.body.innerHTML = '<input type="text">';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('text');
    });

    it('returns "text" for input[type=email] (not in special list)', () => {
      document.body.innerHTML = '<input type="email">';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('text');
    });

    it('returns "text" for input[type=password] (not in special list)', () => {
      document.body.innerHTML = '<input type="password">';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('text');
    });

    it('returns "date" for input[type=date]', () => {
      document.body.innerHTML = '<input type="date">';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('date');
    });

    it('returns "file" for input[type=file]', () => {
      document.body.innerHTML = '<input type="file">';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('file');
    });

    it('returns "text" for input with no type attribute', () => {
      document.body.innerHTML = '<input>';
      expect(Recorder.getFieldType(document.querySelector('input'))).toBe('text');
    });

    it('returns "text" for unknown elements (div, span, etc.)', () => {
      document.body.innerHTML = '<div contenteditable="true"></div>';
      expect(Recorder.getFieldType(document.querySelector('div'))).toBe('text');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getValue
  // ──────────────────────────────────────────────────────────────

  describe('getValue', () => {
    it('returns checked boolean for checkbox', () => {
      document.body.innerHTML = '<input type="checkbox" checked>';
      const el = document.querySelector('input');
      expect(Recorder.getValue(el)).toBe(true);
    });

    it('returns false for unchecked checkbox', () => {
      document.body.innerHTML = '<input type="checkbox">';
      const el = document.querySelector('input');
      expect(Recorder.getValue(el)).toBe(false);
    });

    it('returns value for radio', () => {
      document.body.innerHTML = '<input type="radio" value="option1">';
      const el = document.querySelector('input');
      expect(Recorder.getValue(el)).toBe('option1');
    });

    it('returns value for text input', () => {
      document.body.innerHTML = '<input type="text" value="hello">';
      const el = document.querySelector('input');
      expect(Recorder.getValue(el)).toBe('hello');
    });

    it('returns value for select', () => {
      document.body.innerHTML = '<select><option value="a">A</option><option value="b" selected>B</option></select>';
      const el = document.querySelector('select');
      expect(Recorder.getValue(el)).toBe('b');
    });

    it('returns value for textarea', () => {
      document.body.innerHTML = '<textarea>some text</textarea>';
      const el = document.querySelector('textarea');
      expect(Recorder.getValue(el)).toBe('some text');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // getClickLabel
  // ──────────────────────────────────────────────────────────────

  describe('getClickLabel', () => {
    it('returns button text content', () => {
      document.body.innerHTML = '<button>Submit</button>';
      const el = document.querySelector('button');
      expect(Recorder.getClickLabel(el)).toBe('Submit');
    });

    it('truncates long text to 60 chars', () => {
      const longText = 'A'.repeat(80);
      document.body.innerHTML = `<button>${longText}</button>`;
      const el = document.querySelector('button');
      const label = Recorder.getClickLabel(el);
      expect(label).toHaveLength(60);
    });

    it('returns aria-label when no text content', () => {
      document.body.innerHTML = '<button aria-label="Close dialog"></button>';
      const el = document.querySelector('button');
      expect(Recorder.getClickLabel(el)).toBe('Close dialog');
    });

    it('returns title when no text or aria-label', () => {
      document.body.innerHTML = '<a title="Go Home"></a>';
      const el = document.querySelector('a');
      expect(Recorder.getClickLabel(el)).toBe('Go Home');
    });

    it('returns value for input[type=submit]', () => {
      document.body.innerHTML = '<input type="submit" value="Send Form">';
      const el = document.querySelector('input');
      expect(Recorder.getClickLabel(el)).toBe('Send Form');
    });

    it('returns tag name as last resort', () => {
      document.body.innerHTML = '<button></button>';
      const el = document.querySelector('button');
      expect(Recorder.getClickLabel(el)).toBe('button');
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Positional selector building
  // ──────────────────────────────────────────────────────────────

  describe('positional selector building', () => {
    it('builds a selector that can find the same element', () => {
      document.body.innerHTML = `
        <div>
          <span>First</span>
          <span>Second</span>
          <div>
            <input type="text">
            <input type="text">
          </div>
        </div>
      `;
      const target = document.querySelectorAll('input')[1];
      const result = Recorder.getSelector(target);

      expect(result.fragile).toBe(true);
      // The generated selector should be able to find the element
      const found = document.querySelector(result.selector);
      expect(found).toBe(target);
    });

    it('does not include nth-of-type when element is the only child of its type', () => {
      document.body.innerHTML = `
        <div>
          <input type="text">
        </div>
      `;
      const target = document.querySelector('input');
      const result = Recorder.getSelector(target);

      // It has no id/name/data-qa, so it falls to positional
      expect(result.fragile).toBe(true);
      // Since it's the only input under div, no nth-of-type needed for the input
      expect(result.selector).not.toContain('input:nth-of-type');
    });
  });
});
