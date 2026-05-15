/*
 * Scalar API reference ↔ [data-theme] bridge.
 *
 * The Scalar widget reads its darkMode flag from the JSON in
 * data-configuration on <script id="api-reference">. It does this once
 * at mount and doesn't expose a hot-swap API, so the best we can do is
 * patch the attribute BEFORE Scalar's bundle parses it — i.e. between
 * the page-rendered <script id="api-reference"> tag and the
 * <script src=".../scalar/api-reference"> tag that mounts the widget.
 *
 * On a runtime theme toggle, Scalar's docs stay in whichever mode they
 * started in (the page chrome — nav, subbar — still flips correctly via
 * theme.css). Re-mounting Scalar on every toggle would be heavy and is
 * out of scope.
 */
(function () {
  'use strict';
  var configScript = document.getElementById('api-reference');
  if (!configScript) return;

  var raw = configScript.getAttribute('data-configuration');
  if (!raw) return;

  var theme = document.documentElement.getAttribute('data-theme');
  if (theme !== 'light' && theme !== 'dark') return;

  try {
    var config = JSON.parse(raw);
    config.darkMode = (theme === 'dark');
    configScript.setAttribute('data-configuration', JSON.stringify(config));
  } catch (e) {
    /* Malformed config — leave it for Scalar to surface. */
  }
})();
