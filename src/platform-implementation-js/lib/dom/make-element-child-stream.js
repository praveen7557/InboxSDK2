/* @flow */
//jshint ignore:start

import asap from 'asap';
import logger from '../logger';
import Kefir from 'kefir';
import kefirStopper from 'kefir-stopper';

export type ElementWithLifetime = {el: HTMLElement, removalStream: Kefir.Stream};

// Emits events whenever the given element has any children added or removed.
// Also when first listened to, it emits events for existing children.
export default function makeElementChildStream(element: HTMLElement): Kefir.Stream<ElementWithLifetime> {
  if (!element || !element.nodeType) {
    throw new Error("Expected element, got "+String(element));
  }

  return Kefir.stream((emitter) => {
    const removalStreams: Map<HTMLElement, Object> = new Map();
    let ended = false;

    function newEl(el: HTMLElement) {
      if (el.nodeType !== 1) return;
      const removalStream = kefirStopper();
      removalStreams.set(el, removalStream);
      emitter.emit({el, removalStream});
    }

    function removedEl(el: HTMLElement) {
      if (el.nodeType !== 1) return;
      const removalStream = removalStreams.get(el);
      removalStreams.delete(el);

      if(removalStream){
        removalStream.destroy();
      } else {
        logger.error(new Error("Could not find removalStream for element with class "+el.className));
      }
    }

    const observer = new MutationObserver(function(mutations) {
      mutations.forEach((mutation) => {
        Array.prototype.forEach.call(mutation.addedNodes, newEl);
        Array.prototype.forEach.call(mutation.removedNodes, removedEl);
      });
    });

    // We don't want to emit the start children synchronously before all
    // stream listeners are subscribed.
    asap(() => {
      if (!ended) {
        observer.observe(element, ({childList: true}: any));
        // Clone child list first because it can change
        Array.prototype.slice.call(element.children).forEach(newEl);
      }
    });

    return function() {
      ended = true;
      observer.disconnect();
      asap(() => {
        removalStreams.forEach((removalStream, el) => {
          removalStream.destroy();
        });
      });
    };
  });
}
