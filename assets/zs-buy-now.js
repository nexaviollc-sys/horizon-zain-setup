/* ZAISEN direct Buy Now: add currently selected variant via Shopify Ajax API,
   then go to checkout. Add to Cart continues to use the theme's product-form code. */
document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-zs-buy-now]') : null;
  if (!button || button.disabled) return;
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
      errorNode.textContent = 'Please finish selecting your options first.';
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
    if (!response.ok || payload.status) throw new Error(payload.description || payload.message || 'Unable to start checkout.');
    window.location.assign(path + 'checkout');
  } catch (error) {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (errorNode) {
      errorNode.hidden = false;
      errorNode.textContent = error?.message || 'Unable to start checkout. Please try again.';
    }
  }
});
