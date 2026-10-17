/*
 * Seamless page changes. A click on a link to another page of the store
 * fetches that page and swaps it in (the page content, the header and the
 * footer) instead of loading it from scratch, so the flowers behind keep
 * running: leaving the splash, the splash itself stays behind the new page
 * in place of the flower world.
 *
 * Anything that needs a real page load gets one: the cart, checkout and
 * account pages, links to other sites or files, links opening in a new tab,
 * a page that brings a garden of its own (the shop page), and anything
 * that fails along the way. Off in the theme editor, and when Theme
 * settings → Garden motif → Seamless page changes is off.
 */
(() => {
  if (window.Shopify && window.Shopify.designMode) return;
  if (!window.history || !history.pushState || !window.DOMParser || !window.fetch) return;

  // Paths that always load normally.
  const HARD = /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:cart|checkout|checkouts|account|apps|a\/|admin|password|challenge|services|tools|gift_cards)(?:\/|$|\?)/i;
  const FILE = /\.(?:pdf|zip|jpe?g|png|gif|webp|svg|mp4|mov|xml|atom|json|js|css|txt|csv)$/i;
  // A garden on its own page (not the world behind every page).
  const SPLASH = 'garden-splash:not([data-mode])';
  const BED = 'garden-splash[data-mode="background"]';

  const cache = new Map();
  let shownUrl = location.pathname + location.search;
  let pending = null;

  history.scrollRestoration = 'manual';
  history.replaceState(Object.assign({}, history.state, { soft: true }), '');

  const urlOf = (a) => {
    try {
      return new URL(a.href, location.href);
    } catch (e) {
      return null;
    }
  };

  const eligible = (a) => {
    if (!a || !a.href || (a.target && a.target !== '_self')) return null;
    if (a.hasAttribute('download') || a.hasAttribute('data-no-soft') || /\bexternal\b/.test(a.rel)) return null;
    const url = urlOf(a);
    if (!url || url.origin !== location.origin) return null;
    if (HARD.test(url.pathname) || FILE.test(url.pathname)) return null;
    // A jump within this same page is the browser's.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return null;
    return url;
  };

  const load = (url) => {
    const key = url.pathname + url.search;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < 30000) return hit.page;
    const page = fetch(key, { credentials: 'same-origin', headers: { Accept: 'text/html' } }).then((res) => {
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !type.includes('text/html')) throw new Error('not a page');
      const end = new URL(res.url);
      if (end.origin !== location.origin || HARD.test(end.pathname)) throw new Error('redirected away');
      return res.text().then((html) => ({ html, url: end }));
    });
    cache.set(key, { at: Date.now(), page });
    page.catch(() => cache.delete(key));
    return page;
  };

  // Pages under the pointer start loading a moment before the click.
  let hoverTimer = 0;
  document.addEventListener(
    'pointerover',
    (e) => {
      const a = e.target instanceof Element && e.target.closest('a[href]');
      const url = a && eligible(a);
      clearTimeout(hoverTimer);
      if (url) hoverTimer = window.setTimeout(() => load(url).catch(() => {}), 80);
    },
    { passive: true }
  );

  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target instanceof Element && e.target.closest('a[href]');
    const url = a && eligible(a);
    if (!url) return;
    e.preventDefault();
    go(url, { push: true });
  });

  window.addEventListener('popstate', (e) => {
    const here = location.pathname + location.search;
    if (here === shownUrl) return;
    go(new URL(location.href), { push: false, scroll: e.state && e.state.softScroll });
  });

  const hard = (url) => window.location.assign(url.href || url);

  async function go(url, { push, scroll }) {
    const token = {};
    pending = token;
    if (push) history.replaceState(Object.assign({}, history.state, { soft: true, softScroll: window.scrollY }), '');
    document.documentElement.classList.add('is-soft-loading');
    let page;
    try {
      page = await load(url);
    } catch (err) {
      return hard(url);
    } finally {
      if (pending === token) document.documentElement.classList.remove('is-soft-loading');
    }
    if (pending !== token) return;
    const doc = new DOMParser().parseFromString(page.html, 'text/html');
    const target = new URL(page.url.href);
    target.hash = url.hash;
    let done = false;
    try {
      done = await swap(doc);
    } catch (err) {
      console.error('soft navigation:', err);
    }
    if (!done) return hard(target);
    if (push) history.pushState({ soft: true }, '', target.href);
    else if (target.href !== location.href) history.replaceState({ soft: true }, '', target.href);
    shownUrl = location.pathname + location.search;
    const anchor = target.hash && document.getElementById(decodeURIComponent(target.hash.slice(1)));
    if (anchor) anchor.scrollIntoView();
    else window.scrollTo(0, push ? 0 : scroll || 0);
    const main = document.getElementById('MainContent');
    if (main) main.focus({ preventScroll: true });
    document.dispatchEvent(new CustomEvent('duet:page-change', { detail: { url: target.href } }));
  }

  /* Puts the fetched page in place of this one. False: it needs a real page load. */
  async function swap(doc) {
    const main = document.getElementById('MainContent');
    const next = doc.getElementById('MainContent');
    if (!main || !next) return false;

    // Which garden carries on behind the new page.
    const world = document.querySelector('garden-splash.garden-world');
    const keptSection = Array.from(main.children).find((s) => s.querySelector(SPLASH));
    const incomingSplash = Array.from(next.children).find((s) => s.querySelector(SPLASH));
    if (main.querySelector(BED) || next.querySelector(BED)) return false;
    let reuse = null;
    if (incomingSplash) {
      if (keptSection && keptSection.id === incomingSplash.id) reuse = keptSection;
      else if (keptSection) return false;
    } else if (!keptSection && !world && doc.querySelector('garden-splash.garden-world')) {
      // The new page wants the flower world, and there is none here to carry over.
      return false;
    }

    await addHead(doc);
    const loadedBefore = new Set(Array.from(document.scripts).map((sc) => sc.src).filter(Boolean));

    // The page itself.
    document.title = doc.title;
    ['meta[name="description"]', 'link[rel="canonical"]'].forEach((sel) => {
      const mine = document.head.querySelector(sel);
      const theirs = doc.head.querySelector(sel);
      if (mine && theirs) mine.replaceWith(theirs.cloneNode(true));
    });
    const behind = !incomingSplash && !!keptSection;
    document.body.className = doc.body.className;
    document.body.classList.toggle('has-splash-behind', behind);
    if (behind) document.body.classList.add('has-garden-world');

    // Header and footer groups.
    const inserted = [];
    const group = (name) => `.shopify-section-group-${name}`;
    ['header-group', 'footer-group'].forEach((name) => {
      const mine = Array.from(document.querySelectorAll(group(name)));
      const ref = mine[0] || (name === 'header-group' ? main : main.nextSibling);
      Array.from(doc.querySelectorAll(group(name))).forEach((n) => {
        const node = document.adoptNode(n);
        main.parentNode.insertBefore(node, ref);
        inserted.push(node);
      });
      mine.forEach((n) => n.remove());
    });
    // A menu left open by the click that brought us here.
    document.documentElement.classList.remove('duet-header-locked');

    // The page content: everything but the garden that carries on.
    Array.from(main.children).forEach((n) => {
      if (n !== keptSection || (!behind && !reuse)) n.remove();
    });
    if (keptSection && (behind || reuse)) keptSection.toggleAttribute('data-soft-keep', behind);
    // The new sections go round the splash that carries on, never moving it (that would restart it).
    // Moved in rather than copied: custom elements then start up already in the page.
    let pastReuse = !reuse;
    Array.from(next.children).forEach((n) => {
      if (reuse && n.id === reuse.id) {
        pastReuse = true;
        return;
      }
      const node = document.adoptNode(n);
      main.insertBefore(node, pastReuse ? null : reuse);
      inserted.push(node);
    });
    const splashEl = keptSection && keptSection.querySelector(SPLASH);
    if (splashEl && splashEl.setBehind) splashEl.setBehind(behind);
    // Back on the splash's own page, or a fresh splash arriving: the world steps aside.
    if (incomingSplash && world) {
      world.remove();
    }

    inserted.forEach((n) => runScripts(n, loadedBefore));
    if (typeof window.initializeScrollAnimationTrigger === 'function') window.initializeScrollAnimationTrigger(main);
    return true;
  }

  /* Styles and scripts the new page needs that this one hasn't loaded. */
  async function addHead(doc) {
    const loads = [];
    const hrefs = new Set(Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.href));
    const styles = new Set(Array.from(document.querySelectorAll('style')).map((s) => s.textContent));
    const srcs = new Set(Array.from(document.scripts).map((s) => s.src).filter(Boolean));
    doc.head.querySelectorAll('link[rel="stylesheet"], style, script[src]').forEach((el) => {
      if (el.tagName === 'LINK') {
        const href = new URL(el.getAttribute('href'), location.href).href;
        if (hrefs.has(href)) return;
        const link = document.importNode(el, true);
        loads.push(
          new Promise((resolve) => {
            link.addEventListener('load', resolve, { once: true });
            link.addEventListener('error', resolve, { once: true });
            window.setTimeout(resolve, 1500);
          })
        );
        document.head.appendChild(link);
      } else if (el.tagName === 'STYLE') {
        if (!styles.has(el.textContent)) document.head.appendChild(document.importNode(el, true));
      } else {
        const src = new URL(el.getAttribute('src'), location.href).href;
        if (srcs.has(src)) return;
        document.head.appendChild(fresh(el));
      }
    });
    await Promise.all(loads);
  }

  /* Scripts parsed from fetched HTML don't run: put live copies in their place. */
  function runScripts(root, loaded) {
    root.querySelectorAll('script').forEach((old) => {
      const type = old.getAttribute('type');
      if (type && !/^(text|application)\/javascript$|^module$/.test(type)) return;
      if (old.src && loaded.has(old.src)) return;
      old.replaceWith(fresh(old));
    });
  }

  function fresh(old) {
    const s = document.createElement('script');
    Array.from(old.attributes).forEach((a) => s.setAttribute(a.name, a.value));
    s.async = false;
    s.textContent = old.textContent;
    return s;
  }
})();
