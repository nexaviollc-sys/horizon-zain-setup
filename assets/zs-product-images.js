export function hydrateProductImages(root) {
  const images = root.matches?.('img[data-zs-product-src]') ? [root] : root.querySelectorAll('img[data-zs-product-src]');
  for (const image of images) {
    image.loading = 'eager';
    if (image.dataset.zsProductSrcset) image.srcset = image.dataset.zsProductSrcset;
    image.src = image.dataset.zsProductSrc;
    delete image.dataset.zsProductSrc;
    delete image.dataset.zsProductSrcset;
  }
}
