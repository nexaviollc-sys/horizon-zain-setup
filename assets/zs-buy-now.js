/* ZAISEN direct Buy Now: add currently selected variant via Shopify Ajax API,
   then go to checkout. Add to Cart continues to use the theme's product-form code. */
document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-zs-buy-now]') : null;
  if (!button || button.disabled) return;
  const lang = (button.dataset.zsLocale || document.documentElement.lang || 'en').slice(0, 2);
  const messages = {
    en: {option:'Please finish selecting your options first.', failed:'Unable to start checkout.', retry:'Unable to start checkout. Please try again.'},
    de: {option:'Bitte schließen Sie zuerst die Produktauswahl ab.', failed:'Der Checkout konnte nicht gestartet werden.', retry:'Der Checkout konnte nicht gestartet werden. Bitte versuchen Sie es erneut.'},
    fr: {option:'Veuillez terminer la sélection des options du produit.', failed:'Impossible de lancer le paiement.', retry:'Impossible de lancer le paiement. Veuillez réessayer.'},
    ar: {option:'يرجى إكمال اختيار خيارات المنتج أولًا.', failed:'تعذّر بدء عملية الدفع.', retry:'تعذّر بدء عملية الدفع. حاول مرة أخرى.'}
  }[lang] || {option:'Please finish selecting your options first.', failed:'Unable to start checkout.', retry:'Unable to start checkout. Please try again.'};
  const form = button.closest('form');
  if (!form || !form.reportValidity()) return;
  const errorNode = form.querySelector('.zs-buy-now__error');
  const activeCartButton = form.querySelector('add-to-cart-component button[name="add"]');
  if (activeCartButton?.disabled) return;
  const data = new FormData(form);
  const id = String(data.get('id') || '');
  if (!/^\d+$/.test(id)) return;

  // If the shopper just changed options, avoid purchasing a stale variant.
  const mainPicker = form.closest('.product-details')?.querySelector('variant-picker');
  const selectedVariantId = mainPicker?.selectedOption?.dataset?.variantId;
  if (selectedVariantId && selectedVariantId !== id) {
    if (errorNode) {
      errorNode.hidden = false;
      errorNode.textContent = messages.option;
    }
    return;
  }
  if (errorNode) { errorNode.hidden = true; errorNode.textContent = ''; }
  button.disabled = true;
  button.setAttribute('aria-busy','true');
  try {
    const root = window.Shopify?.routes?.root || '/';
    const path = root.endsWith('/') ? root : root + '/';
    const response = await fetch(path + 'cart/add.js', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Accept': 'application/json' },
      body: data
    });
    const payload = await response.json();
    if (!response.ok || payload.status) throw new Error(payload.description || payload.message || messages.failed);
    window.location.assign('/checkout');
  } catch (error) {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (errorNode) {
      errorNode.hidden = false;
      errorNode.textContent = error?.message || messages.retry;
    }
  }
});


// Keep Buy Now availability in sync when the theme changes variants or morphs controls.
const zsAttachBuyNowSync = () => {
  document.querySelectorAll('.product-information product-form-component form').forEach((form) => {
    if (!form.querySelector('[data-zs-buy-now]') || form.dataset.zsBuyNowBound) return;
    form.dataset.zsBuyNowBound = 'true';
    const sync = () => {
      const buy = form.querySelector('[data-zs-buy-now]');
      const add = form.querySelector('add-to-cart-component button[name="add"]');
      if (buy && add && buy.disabled !== add.disabled && !buy.matches('[aria-busy="true"]')) {
        buy.disabled = add.disabled;
      }
    };
    new MutationObserver(sync).observe(form, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    sync();
  });
};
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', zsAttachBuyNowSync, { once: true });
} else {
  zsAttachBuyNowSync();
}
