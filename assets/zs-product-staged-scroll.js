/**
 * ZAISEN desktop product pages: staged, natural page scrolling.
 *
 * Phase 1: gallery scrolls down while the product details stay in place.
 * Phase 2: gallery stops with its bottom visible while the details scroll.
 * Phase 3: after both are read, the rest of the page flows as usual.
 *
 * The browser keeps ownership of scrolling (wheel, touchpad, keyboard, links).
 * No preventDefault, scroll locking, or nested scrolling containers.
 * Disabled on smaller screens and for reduced-motion preferences.
 */
(() => {
  if (window.__zsStagedProductScrollLoaded) return;
  window.__zsStagedProductScrollLoaded = true;

  const VIEWPORT_QUERY = '(min-width: 1024px) and (min-height: 600px) and (prefers-reduced-motion: no-preference)';
  const mediaQuery = window.matchMedia(VIEWPORT_QUERY);
  const instances = new WeakMap();
  const activeInstances = new Set();

  function headerOffset() {
    const header = document.querySelector('#header-component');
    if (!(header instanceof HTMLElement)) return 0;

    const bounds = header.getBoundingClientRect();
    // A header still in its normal position lower down the page is not
    // obscuring anything. Only account for headers pinned to the viewport.
    if (bounds.top > 8 || bounds.bottom <= 0) return 0;
    return Math.min(160, Math.max(0, Math.round(bounds.bottom) + 10));
  }

  function createInstance(section) {
    if (instances.has(section)) return;
    const grid = section.querySelector('product-component.product-information__grid');
    const media = grid?.querySelector(':scope > .product-information__media');
    const details = grid?.querySelector(':scope > .product-details');

    if (!(grid instanceof HTMLElement) ||
        !(media instanceof HTMLElement) ||
        !(details instanceof HTMLElement)) return;

    const state = {
      section, grid, media, details,
      enabled: false,
      first: 0, second: 0, total: 0,
      offset: 0,
      frame: 0,
      observer: null,
      lastMediaHeight: 0,
      lastDetailsHeight: 0,
      previousHeight: grid.style.height,
      previousMediaTransform: media.style.transform,
      previousDetailsTransform: details.style.transform,
    };

    function clear() {
      state.enabled = false;
      state.grid.removeAttribute('data-zs-staged-scroll');
      state.grid.style.height = state.previousHeight;
      state.media.style.transform = state.previousMediaTransform;
      state.details.style.transform = state.previousDetailsTransform;
    }

    function measure() {
      const wasEnabled = state.enabled;
      // Do not read the grid height (it is our scroll track).
      // Transforms do not change layout heights of the two columns.
      const mediaHeight = state.media.getBoundingClientRect().height;
      const detailsHeight = state.details.getBoundingClientRect().height;
      const offset = headerOffset();
      const available = Math.max(350, window.innerHeight - offset - 14);

      const first = Math.max(0, Math.ceil(mediaHeight - available));
      const second = Math.max(0, Math.ceil(detailsHeight - available));

      // Both columns must have meaningful overflow to justify staging.
      // Otherwise restore ordinary Horizon scrolling.
      if (!mediaQuery.matches || !state.grid.isConnected ||
          first < 65 || second < 65) {
        if (wasEnabled) clear();
        return;
      }

      state.enabled = true;
      state.first = first;
      state.second = second;
      state.total = first + second;
      state.offset = offset;
      state.lastMediaHeight = mediaHeight;
      state.lastDetailsHeight = detailsHeight;
      state.grid.setAttribute('data-zs-staged-scroll', 'on');

      // The native page provides enough scroll distance for BOTH phases.
      // Its next section begins immediately after the content is finished.
      const height = Math.ceil(available + first + second);
      const value = `${height}px`;
      if (state.grid.style.height !== value) state.grid.style.height = value;
      update();
    }

    function update() {
      if (!state.enabled || !mediaQuery.matches) return;
      const progress = Math.max(
        0, Math.min(state.total, state.offset - state.grid.getBoundingClientRect().top)
      );
      // Keep details fixed while gallery reaches its bottom.
      const detailsCompensation = Math.min(state.first, progress);
      // Keep the gallery's bottom in view while reading further details.
      const mediaCompensation = Math.max(0, progress - state.first);

      const mediaValue = `translate3d(0, ${Math.round(mediaCompensation)}px, 0)`;
      const detailsValue = `translate3d(0, ${Math.round(detailsCompensation)}px, 0)`;
      if (state.media.style.transform !== mediaValue) state.media.style.transform = mediaValue;
      if (state.details.style.transform !== detailsValue) state.details.style.transform = detailsValue;
    }

    function requestUpdate() {
      if (state.frame) return;
      state.frame = requestAnimationFrame(() => {
        state.frame = 0;
        const currentHeader = headerOffset();
        // Sticky header position can change as the visitor scrolls.
        if (state.enabled && Math.abs(currentHeader - state.offset) > 8) {
          measure();
        } else {
          update();
        }
      });
    }

    const resizeObserver = new ResizeObserver(() => {
      if (!state.grid.isConnected) return;
      requestAnimationFrame(measure);
    });
    resizeObserver.observe(media);
    resizeObserver.observe(details);
    state.observer = resizeObserver;

    state.measure = measure;
    state.update = requestUpdate;
    state.cleanup = () => {
      resizeObserver.disconnect();
      if (state.frame) cancelAnimationFrame(state.frame);
      clear();
    };

    instances.set(section, state);
    activeInstances.add(state);
    measure();
  }

  function setup() {
    document.querySelectorAll(
      '.product-information[data-testid="product-information"]'
    ).forEach(createInstance);
  }

  function onScroll() {
    for (const state of activeInstances) {
      if (!state.grid.isConnected) {
        state.cleanup();
        activeInstances.delete(state);
      } else {
        state.update();
      }
    }
  }

  function onResize() {
    for (const state of activeInstances) state.measure();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize, { passive: true });
  mediaQuery.addEventListener('change', onResize);

  document.addEventListener('shopify:section:load', () => {
    onScroll();
    setup();
  });
  document.addEventListener('shopify:section:unload', onScroll);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setup, { once: true });
  } else {
    setup();
  }
})();
