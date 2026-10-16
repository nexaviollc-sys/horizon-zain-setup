/* ZAISEN one-at-a-time related-product suggestions.
   Uses Shopify's native recommendations section response and product form components.
   Never adds a variant automatically when an option choice is required. */
if (!customElements.get('zs-quick-pairs')) {
  customElements.define('zs-quick-pairs', class extends HTMLElement {
    connectedCallback() {
      this.track = this.querySelector('.zs-pairs__track');
      this.prev = this.querySelector('[data-zs-prev]');
      this.next = this.querySelector('[data-zs-next]');
      this.notice = this.querySelector('.zs-pairs__notice');
      this.index = 0;
      this.timer = null;
      this.interacting = false;
      this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.onPrev = () => this.move(-1);
      this.onNext = () => this.move(1);
      this.onPause = () => { this.interacting = true; this.stop(); };
      this.onResume = () => { this.interacting = false; this.start(); };
      this.onVisibility = () => document.hidden ? this.stop() : this.start();
      this.onScroll = () => this.syncArrows();
      this.prev?.addEventListener('click', this.onPrev);
      this.next?.addEventListener('click', this.onNext);
      this.addEventListener('mouseenter', this.onPause);
      this.addEventListener('mouseleave', this.onResume);
      this.addEventListener('focusin', this.onPause);
      this.addEventListener('focusout', this.onResume);
      this.track?.addEventListener('touchstart', this.onPause, { passive: true });
      this.track?.addEventListener('touchend', this.onResume, { passive: true });
      this.track?.addEventListener('scroll', this.onScroll, { passive: true });
      document.addEventListener('visibilitychange', this.onVisibility);
      this.hydrate();
    }
    disconnectedCallback() {
      this.stop();
      this.prev?.removeEventListener('click', this.onPrev);
      this.next?.removeEventListener('click', this.onNext);
      this.removeEventListener('mouseenter', this.onPause);
      this.removeEventListener('mouseleave', this.onResume);
      this.removeEventListener('focusin', this.onPause);
      this.removeEventListener('focusout', this.onResume);
      this.track?.removeEventListener('touchstart', this.onPause);
      this.track?.removeEventListener('touchend', this.onResume);
      this.track?.removeEventListener('scroll', this.onScroll);
      document.removeEventListener('visibilitychange', this.onVisibility);
    }
    async load(intent) {
      const url = new URL(this.dataset.endpoint, window.location.origin);
      url.searchParams.set('section_id', this.dataset.section);
      url.searchParams.set('product_id', this.dataset.product);
      url.searchParams.set('limit', this.dataset.limit || '8');
      url.searchParams.set('intent', intent);
      const response = await fetch(url.toString(), { credentials: 'same-origin' });
      if (!response.ok) throw new Error('Recommendations could not load');
      const dom = new DOMParser().parseFromString(await response.text(), 'text/html');
      const source = [...dom.querySelectorAll('[data-zs-pairs-track]')]
        .find(el => el.getAttribute('data-zs-pairs-track') === this.dataset.block);
      return source?.children ? [...source.children] : [];
    }
    async hydrate() {
      if (!this.track) return;
      try {
        let items = await this.load('complementary');
        if (!items.length) items = await this.load('related');
        if (!this.isConnected) return;
        if (!items.length) { this.hidden = true; return; }
        this.track.replaceChildren(...items.map(el => document.importNode(el, true)));
        this.cards = [...this.track.children];
        this.syncArrows();
        this.start();
      } catch (error) {
        if (this.isConnected) this.hidden = true;
      }
    }
    syncArrows() {
      const cards = [...(this.track?.children || [])];
      if (!cards.length) return;
      let nearest = 0, distance = Infinity;
      cards.forEach((card, i) => {
        const d = Math.abs(card.offsetLeft - cards[0].offsetLeft - this.track.scrollLeft);
        if (d < distance) { distance = d; nearest = i; }
      });
      this.index = nearest;
      if (this.prev) this.prev.disabled = cards.length < 2;
      if (this.next) this.next.disabled = cards.length < 2;
    }
    move(direction) {
      const cards = [...(this.track?.children || [])];
      if (cards.length < 2) return;
      const nextIndex = (this.index + direction + cards.length) % cards.length;
      this.index = nextIndex;
      const left = cards[nextIndex].offsetLeft - cards[0].offsetLeft;
      this.track.scrollTo({ left, behavior: this.reduceMotion.matches ? 'instant' : 'smooth' });
    }
    start() {
      if (this.timer || this.interacting || document.hidden || this.reduceMotion.matches) return;
      if ((this.track?.children.length || 0) < 2) return;
      this.timer = window.setInterval(() => this.move(1), Math.max(2000, Number(this.dataset.delay) || 2000));
    }
    stop() {
      if (this.timer) window.clearInterval(this.timer);
      this.timer = null;
    }
  });
}
