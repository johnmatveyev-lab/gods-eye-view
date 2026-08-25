/**
 * Hosted Clear control for the voice whiteboard.
 *
 * Speaks-to-marks already accumulate in the annotation store. This chrome
 * calls that same `clear()` action so a user can erase the board without a
 * voice command. Trails, models, and tracking stay on their own stores.
 */

/**
 * Bind a Clear annotations button to the existing annotation store.
 *
 * @param {{ clear: Function, count?: Function, onChange?: Function }} annotations
 * @param {{ button?: { disabled: boolean, addEventListener: Function, removeEventListener?: Function, setAttribute?: Function } }} [options]
 * @returns {{ button: object, sync: Function, destroy: Function } | null}
 */
export function initAnnotationClearControl(annotations, { button = defaultButton() } = {}) {
  if (!annotations || typeof annotations.clear !== 'function' || !button) return null;

  const sync = () => {
    const empty = liveCount(annotations) === 0;
    button.disabled = empty;
    button.setAttribute?.('aria-disabled', empty ? 'true' : 'false');
  };

  const onClick = (event) => {
    event?.preventDefault?.();
    if (liveCount(annotations) === 0) return;
    annotations.clear();
    sync();
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
  return document.getElementById('clear-annotations');
}
