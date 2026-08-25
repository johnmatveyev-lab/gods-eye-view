/**
 * Hosted Undo control for the voice whiteboard.
 *
 * Speaks-to-marks already accumulate in the annotation store. This chrome
 * calls `removeLast()` so a user can drop one wrong pin without wiping the
 * board. It does not bump the clear() generation or abort in-flight annotate.
 */

/**
 * Bind an Undo last annotation button to the existing annotation store.
 *
 * @param {{ removeLast: Function, count?: Function, onChange?: Function }} annotations
 * @param {{ button?: { disabled: boolean, addEventListener: Function, removeEventListener?: Function, setAttribute?: Function } }} [options]
 * @returns {{ button: object, sync: Function, destroy: Function } | null}
 */
export function initAnnotationUndoControl(annotations, { button = defaultButton() } = {}) {
  if (!annotations || typeof annotations.removeLast !== 'function' || !button) return null;

  const sync = () => {
    const empty = liveCount(annotations) === 0;
    button.disabled = empty;
    button.setAttribute?.('aria-disabled', empty ? 'true' : 'false');
  };

  const onClick = (event) => {
    event?.preventDefault?.();
    if (liveCount(annotations) === 0) return;
    annotations.removeLast();
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
  return document.getElementById('undo-annotations');
}
