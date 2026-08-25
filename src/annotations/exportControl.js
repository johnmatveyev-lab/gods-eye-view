/**
 * Hosted Export control for the voice whiteboard.
 *
 * Speaks-to-marks already accumulate in the annotation store. This chrome
 * turns `engine.list()` into a same-tab GeoJSON download so operators can
 * take marks out of Meridian. Trails, models, and tracking stay put.
 * The voice tools are unchanged.
 */

import {
  annotationsToExportCollection,
  downloadAnnotationsGeoJson,
} from './annotationExport.js';

/**
 * Bind an Export annotations button to the existing annotation store.
 *
 * @param {{ list: Function, count?: Function, onChange?: Function }} annotations
 * @param {{ button?: { disabled: boolean, addEventListener: Function, removeEventListener?: Function, setAttribute?: Function }, download?: Function }} [options]
 * @returns {{ button: object, sync: Function, destroy: Function } | null}
 */
export function initAnnotationExportControl(annotations, {
  button = defaultButton(),
  download = downloadAnnotationsGeoJson,
} = {}) {
  if (!annotations || typeof annotations.list !== 'function' || !button) return null;

  const sync = () => {
    const empty = liveCount(annotations) === 0;
    button.disabled = empty;
    button.setAttribute?.('aria-disabled', empty ? 'true' : 'false');
  };

  const onClick = (event) => {
    event?.preventDefault?.();
    if (liveCount(annotations) === 0) return;
    download(annotationsToExportCollection(annotations.list()));
  };

  button.addEventListener('click', onClick);
  const unsubscribe = typeof annotations.onChange === 'function'
    ? annotations.onChange(sync)
    : null;
  sync();

  return {
    button,
    sync,
    destroy() {
      button.removeEventListener?.('click', onClick);
      unsubscribe?.();
    },
  };
}

function liveCount(annotations) {
  return typeof annotations.count === 'function' ? annotations.count() : 0;
}

function defaultButton() {
  if (typeof document === 'undefined') return null;
  return document.getElementById('export-annotations');
}
