/**
 * ZAISEN product media: keep the desktop gallery at the active image's
 * original aspect ratio. This removes side bars on portrait photos without
 * cropping an artisan product or altering Shopify's native slider/zoom.
 */
(() => {
  if (window.__zsGalleryAspectInitialized) return;
  window.__zsGalleryAspectInitialized = true;

  const SELECTOR = 'media-gallery.zs-atelier-gallery';
  const records = new WeakMap();

  function activeRatio(gallery) {
    const slide = gallery.querySelector(
      'slideshow-slides > slideshow-slide[aria-hidden="false"]'
    ) || gallery.querySelector('slideshow-slides > slideshow-slide:not([hidden])');
    const productMedia = slide?.querySelector('.product-media');
    let ratio = Number(productMedia?.style.getPropertyValue('--ratio'));
    if (!(ratio > 0) || !Number.isFinite(ratio)) {
      const img = slide?.querySelector('.product-media__image');
      const width = Number(img?.getAttribute('width')) || img?.naturalWidth;
      const height = Number(img?.getAttribute('height')) || img?.naturalHeight;
      ratio = width > 0 && height > 0 ? width / height : NaN;
    }
    return Number.isFinite(ratio) && ratio > 0 ? ratio : 0.75;
  }

  function update(gallery) {
    const ratio = activeRatio(gallery);
    const value = String(Math.min(3, Math.max(0.4, ratio)));
    if (gallery.style.getPropertyValue('--zs-gallery-active-ratio') !== value) {
      gallery.style.setProperty('--zs-gallery-active-ratio', value);
    }
  }

  function attach(gallery) {
    if (records.has(gallery)) return;
    const observer = new MutationObserver((mutations) => {
      if (mutations.some(m => m.type === 'attributes' || m.type === 'childList')) {
        update(gallery);
      }
    });
    observer.observe(gallery, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'hidden'],
    });
    records.set(gallery, observer);
    update(gallery);
  }

  function refresh() {
    document.querySelectorAll(SELECTOR).forEach(attach);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', refresh, { once: true });
  } else {
    refresh();
  }

  // Shopify can replace the gallery when a customer changes a variant.
  // Observe only newly inserted product-gallery nodes.
  const host = document.querySelector('[data-testid="product-information"]');
  if (host) {
    const hostObserver = new MutationObserver(() => refresh());
    hostObserver.observe(host, { childList: true, subtree: false });
  }

  document.addEventListener('shopify:section:load', refresh);
})();
