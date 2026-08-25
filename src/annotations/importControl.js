/**
 * Hosted Import control for the voice whiteboard.
 *
 * Operators load a Plan 114 `meridian-annotations.geojson` FeatureCollection
 * back onto the board. Marks append (clearPrevious false). The file picker
 * stays enabled on an empty board — Import is how you fill it. Trails, models,
 * and tracking stay put. The voice tools are unchanged. No /api.
 */

import {
  IMPORT_INVALID_STATUS,
  parseAnnotationImportText,
} from './annotationImport.js';

export { IMPORT_INVALID_STATUS };

/**
 * Bind an Import annotations button to the existing annotation store.
 *
 * @param {{ annotate: Function }} annotations
 * @param {{
 *   button?: { disabled: boolean, addEventListener: Function, removeEventListener?: Function, setAttribute?: Function },
 *   pickFile?: Function,
 *   readText?: Function,
 *   showStatus?: Function,
 * }} [options]
 * @returns {{ button: object, destroy: Function } | null}
 */
export function initAnnotationImportControl(annotations, {
  button = defaultButton(),
  pickFile = defaultPickFile,
  readText = defaultReadText,
  showStatus = defaultShowStatus,
} = {}) {
  if (!annotations || typeof annotations.annotate !== 'function' || !button) return null;

  let busy = false;

  const setEnabled = (enabled) => {
    button.disabled = !enabled;
    button.setAttribute?.('aria-disabled', enabled ? 'false' : 'true');
  };

  setEnabled(true);

  const onClick = async (event) => {
    event?.preventDefault?.();
    if (busy) return;
    busy = true;
    setEnabled(false);
    try {
      const file = await pickFile();
      if (!file) return;
      const text = await readText(file);
      const parsed = parseAnnotationImportText(text);
      if (!parsed.ok) {
        showStatus?.(IMPORT_INVALID_STATUS);
        return;
      }
      if (!parsed.specs.length) return;
      await annotations.annotate(parsed.specs, {
        clearPrevious: false,
        persist: true,
        flyTo: false,
      });
    } catch {
      showStatus?.(IMPORT_INVALID_STATUS);
    } finally {
      busy = false;
      setEnabled(true);
    }
  };

  button.addEventListener('click', onClick);

  return {
    button,
    destroy() {
      button.removeEventListener?.('click', onClick);
    },
  };
}

function defaultButton() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('import-annotations');
}

function defaultPickFile() {
  return new Promise((resolve) => {
    const createElement = document.createElement.bind(document);
    const input = createElement('input');
    input.type = 'file';
    input.accept = '.geojson,application/geo+json,application/json';
    input.addEventListener('change', () => {
      resolve(input.files?.[0] || null);
    }, { once: true });
    input.click();
  });
}

function defaultReadText(file) {
  return file.text();
}

function defaultShowStatus(message) {
  const toast = typeof document === 'undefined' ? null : document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('visible');
}
