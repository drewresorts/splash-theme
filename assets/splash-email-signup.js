/**
 * Splash homepage email — never navigate to /challenge; captcha in overlay on splash.
 */
(function () {
  'use strict';

  if (window.__splashEmailSignupLoaded) return;
  window.__splashEmailSignupLoaded = true;

  function isSplashEmailForm(el) {
    return el && el.matches && el.matches('form.splash-streams__email-form');
  }

  function blockDocumentSubmit(ev) {
    if (!isSplashEmailForm(ev.target)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
    var root = ev.target.closest('[data-splash-email-root]');
    if (root) {
      var btn = root.querySelector('[data-splash-email-submit]');
      if (btn) btn.click();
    }
    return false;
  }

  document.addEventListener('submit', blockDocumentSubmit, true);

  var STRINGS = {
    error: 'Please enter a valid email address.',
    captcha: 'Check the box in the dialog, tap Submit there, then tap Continue below.',
  };

  var stringsEl = document.querySelector('[data-splash-streams-strings]');
  if (stringsEl) {
    try {
      var parsed = JSON.parse(stringsEl.textContent || '{}');
      if (parsed.emailError) STRINGS.error = parsed.emailError;
      if (parsed.emailCaptcha) STRINGS.captcha = parsed.emailCaptcha;
    } catch (e) {
      /* defaults */
    }
  }

  function $(root, sel) {
    return root.querySelector(sel);
  }

  function showError(el, msg) {
    if (!el) return;
    el.hidden = false;
    el.textContent = msg;
  }

  function hideError(el) {
    if (!el) return;
    el.hidden = true;
    el.textContent = '';
  }

  function hideChallenge(root) {
    var overlay = $(root, '[data-splash-email-challenge-overlay]');
    var frame = $(root, '[data-splash-email-challenge-frame]');
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    if (frame) frame.removeAttribute('src');
    document.documentElement.classList.remove('splash-streams--challenge-open');
  }

  function showChallenge(root, form) {
    var overlay = $(root, '[data-splash-email-challenge-overlay]');
    var frame = $(root, '[data-splash-email-challenge-frame]');
    if (!overlay || !frame) return;

    var formId = form.id || 'contact_form';
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    document.documentElement.classList.add('splash-streams--challenge-open');
    frame.src = '/challenge#' + encodeURIComponent(formId);
  }

  window.__splashEmailShowChallenge = showChallenge;

  function showSuccess(root) {
    var formPanel = $(root, '[data-splash-email-form-panel]');
    var successPanel = $(root, '[data-splash-email-success-panel]');
    var status = successPanel && successPanel.querySelector('[role="status"]');
    hideChallenge(root);
    hideError($(root, '[data-splash-email-error]'));
    if (formPanel) formPanel.hidden = true;
    if (successPanel) {
      successPanel.hidden = false;
      if (status) status.focus({ preventScroll: true });
    }
  }

  function isSuccessHtml(html, blockId) {
    if (!html) return false;
    if (html.indexOf('data-splash-email-just-success') !== -1) return true;
    if (blockId && html.indexOf('SplashEmailSuccess-' + blockId) !== -1) return true;
    if (html.indexOf('newsletter-form__message--success') !== -1) return true;
    if (html.indexOf('splash-streams__email-message--success') !== -1) return true;
    return false;
  }

  function isChallengeHtml(html, url) {
    if (url && url.indexOf('/challenge') !== -1) return true;
    if (!html) return false;
    return html.indexOf('shopify-challenge') !== -1 || html.indexOf('challenge__container') !== -1;
  }

  function postForm(form) {
    return fetch(form.getAttribute('action') || '/contact', {
      method: 'POST',
      body: new FormData(form),
      credentials: 'same-origin',
      redirect: 'manual',
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    }).then(function (res) {
      return res.text().then(function (html) {
        return {
          status: res.status,
          ok: res.ok,
          type: res.type,
          html: html,
          url: res.url || '',
        };
      });
    });
  }

  function handleResult(result, root, form, blockId, errorEl, submitBtn) {
    if (submitBtn) submitBtn.disabled = false;

    var challenge =
      result.type === 'opaqueredirect' ||
      result.status === 400 ||
      result.status === 302 ||
      result.status === 303 ||
      isChallengeHtml(result.html, result.url);

    if (challenge) {
      showChallenge(root, form);
      showError(errorEl, STRINGS.captcha);
      return;
    }

    if (isSuccessHtml(result.html, blockId) || (result.ok && result.status >= 200 && result.status < 300)) {
      showSuccess(root);
      return;
    }

    if (result.status === 422 || (result.html && result.html.indexOf('email-message--error') !== -1)) {
      showError(errorEl, STRINGS.error);
      return;
    }

    showError(errorEl, STRINGS.error);
  }

  function runSubmit(root, form, blockId, errorEl, submitBtn) {
    function run() {
      postForm(form)
        .then(function (result) {
          handleResult(result, root, form, blockId, errorEl, submitBtn);
        })
        .catch(function () {
          if (submitBtn) submitBtn.disabled = false;
          showError(errorEl, STRINGS.error);
        });
    }

    if (window.Shopify && window.Shopify.captcha && typeof window.Shopify.captcha.protect === 'function') {
      window.Shopify.captcha.protect(form, run);
    } else {
      run();
    }
  }

  function blockNativeSubmit(form) {
    form.setAttribute('data-splash-email-blocked', 'true');
    form.addEventListener(
      'submit',
      function (ev) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        return false;
      },
      true
    );
    var nativeSubmit = form.submit;
    form.submit = function () {
      var root = form.closest('[data-splash-email-root]');
      if (root) {
        var btn = $(root, '[data-splash-email-submit]');
        if (btn) btn.click();
      }
      return false;
    };
  }

  function bindRoot(root) {
    var form = $(root, 'form.splash-streams__email-form');
    if (!form || form.dataset.splashEmailBound === '1') return;
    form.dataset.splashEmailBound = '1';

    blockNativeSubmit(form);

    var blockId = root.getAttribute('data-splash-email-block-id');
    var errorEl = $(root, '[data-splash-email-error]');
    var submitBtn = $(root, '[data-splash-email-submit]');
    var emailInput = form.querySelector('input[type="email"]');

    if (window.Shopify && window.Shopify.captcha && typeof window.Shopify.captcha.protect === 'function') {
      window.Shopify.captcha.protect(form, function () {});
    }

    var doneBtn = $(root, '[data-splash-email-challenge-done]');
    if (doneBtn) {
      doneBtn.addEventListener('click', function () {
        hideChallenge(root);
        hideError(errorEl);
        if (submitBtn) {
          submitBtn.disabled = true;
          runSubmit(root, form, blockId, errorEl, submitBtn);
        }
      });
    }

    if (root.hasAttribute('data-splash-email-just-success')) {
      showSuccess(root);
    }

    function onSubscribeClick() {
      hideError(errorEl);
      if (!form.checkValidity || form.checkValidity()) {
        if (submitBtn) submitBtn.disabled = true;
        runSubmit(root, form, blockId, errorEl, submitBtn);
      } else if (form.reportValidity) {
        form.reportValidity();
      }
    }

    if (submitBtn) {
      submitBtn.addEventListener('click', onSubscribeClick);
    }

    if (emailInput) {
      emailInput.addEventListener('keydown', function (ev) {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          onSubscribeClick();
        }
      });
    }

    var sink = $(root, '[data-splash-email-post-sink]');
    if (sink) {
      sink.addEventListener('load', function () {
        var path = '';
        try {
          path = sink.contentWindow && sink.contentWindow.location ? sink.contentWindow.location.pathname : '';
        } catch (e) {
          path = '';
        }
        if (path.indexOf('/challenge') !== -1) {
          showChallenge(root, form);
          var err = $(root, '[data-splash-email-error]');
          showError(err, STRINGS.captcha);
        }
      });
    }
  }

  function init(scope) {
    (scope || document).querySelectorAll('[data-splash-email-root]').forEach(bindRoot);
  }

  function boot() {
    init();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  document.addEventListener('shopify:section:load', function (ev) {
    init(ev.target);
  });
})();
