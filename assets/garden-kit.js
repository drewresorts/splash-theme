/*
 * Garden kit: grows flower beds as they scroll into view, and blooms a
 * flower on the cart icon when something is added. See garden-kit.css.
 */
(() => {
  const ROWS = 8;

  // Flowers waiting on their seed grow once they are on screen.
  const io =
    'IntersectionObserver' in window
      ? new IntersectionObserver(
          (entries) => {
            entries.forEach((e) => {
              if (!e.isIntersecting) return;
              e.target.classList.add('is-grown');
              io.unobserve(e.target);
            });
          },
          { rootMargin: '0px 0px -10% 0px' }
        )
      : null;
  const grow = (root) => {
    root.querySelectorAll('.garden-flower--grow:not([data-garden-watched])').forEach((el) => {
      el.setAttribute('data-garden-watched', '');
      if (io) io.observe(el);
      else el.classList.add('is-grown');
    });
  };

  // Added to cart: a flower blooms over the cart icon, then fades.
  let bloomRow = 0;
  const bloom = () => {
    const icon = document.getElementById('cart-icon-bubble');
    if (!icon || !document.body.classList.contains('garden-cart-motif')) return;
    const r = icon.getBoundingClientRect();
    if (!r.width) return;
    const el = document.createElement('span');
    el.className = 'garden-flower garden-cart-bloom';
    el.setAttribute('aria-hidden', 'true');
    const size = 72;
    el.style.setProperty('--gf-row', String(bloomRow++ % ROWS));
    el.style.left = `${r.left + r.width / 2 - size / 2}px`;
    el.style.top = `${r.top + r.height / 2 - size / 2}px`;
    document.body.appendChild(el);
    window.setTimeout(() => el.remove(), 2400);
  };

  const init = () => {
    grow(document);
    // Sections re-rendered by the theme editor or by filtering bring new beds.
    document.addEventListener('shopify:section:load', (e) => grow(e.target));
    new MutationObserver(() => grow(document)).observe(document.getElementById('MainContent') || document.body, {
      childList: true,
      subtree: true,
    });

    if (typeof subscribe === 'function' && typeof PUB_SUB_EVENTS !== 'undefined') {
      subscribe(PUB_SUB_EVENTS.cartUpdate, (event) => {
        if (event && (event.source === 'product-form' || event.source === 'quick-add')) bloom();
      });
    }

    // Fetch the sprite sheet once the page is idle, so the first hover is instant.
    const warm = () => {
      const probe = document.createElement('span');
      probe.className = 'garden-flower';
      probe.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0';
      document.body.appendChild(probe);
      window.setTimeout(() => probe.remove(), 4000);
    };
    if ('requestIdleCallback' in window) requestIdleCallback(warm, { timeout: 3000 });
    else window.setTimeout(warm, 1500);
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
