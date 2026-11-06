
(() => {
  const loadImage = image => {
    if (!image.dataset.zsSrc) return;
    if (image.dataset.zsSrcset) image.srcset = image.dataset.zsSrcset;
    image.src = image.dataset.zsSrc;
    delete image.dataset.zsSrc;
    delete image.dataset.zsSrcset;
  };
  const observer = 'IntersectionObserver' in window ? new IntersectionObserver(entries => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      loadImage(entry.target);
      observer.unobserve(entry.target);
    }
  }, { rootMargin: '250px 0px', threshold: 0 }) : null;
  function prepare(root) {
    const images = root.matches?.('img[data-zs-src]') ? [root] : root.querySelectorAll('img[data-zs-src]');
    for (const image of images) {
      if (observer) observer.observe(image);
      else loadImage(image);
    }
  }
  prepare(document);
  new MutationObserver(records => {
    for (const record of records) {
      for (const node of record.addedNodes) if (node.nodeType === 1) prepare(node);
    }
  }).observe(document.body, { childList: true, subtree: true });
  function prepareHover(media) {
    const template = media.querySelector('template[data-zs-hover-image]');
    if (!template) return;
    const fragment = template.content.cloneNode(true);
    const image = fragment.querySelector('img');
    if (!image) return;
    image.addEventListener('load', () => media.classList.add('zsp__media--secondary-ready'), { once: true });
    template.replaceWith(fragment);
    if (image.complete && image.naturalWidth) media.classList.add('zsp__media--secondary-ready');
  }
  document.addEventListener('pointerover', event => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    const media = event.target.closest?.('.zsp__media--has-secondary');
    if (media) prepareHover(media);
  }, { passive: true });
  document.addEventListener('focusin', event => {
    const card = event.target.closest?.('.zsp__link');
    const media = card?.querySelector('.zsp__media--has-secondary');
    if (media) prepareHover(media);
  });
})();
