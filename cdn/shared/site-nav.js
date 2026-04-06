/**
 * CloudCDN — Unified site navigation behavior.
 *
 * Handles:
 *   • Hamburger open/close with aria-expanded state
 *   • Escape key closes the mobile menu
 *   • Click outside closes the mobile menu
 *   • Login/Logout label swap based on cdn_logged_in cookie
 *   • aria-current="page" on active nav link
 *   • Resize handler closes menu when transitioning to desktop
 */
(function () {
  "use strict";

  // --- Auth indicator ---
  // Replace Login with Logout if the non-HttpOnly cdn_logged_in cookie exists
  var loggedIn = document.cookie.split(";").some(function (c) {
    return c.trim().indexOf("cdn_logged_in=") === 0;
  });
  var authLink = document.getElementById("auth-link");
  if (loggedIn && authLink) {
    authLink.textContent = authLink.getAttribute("data-logout-label") || "Logout";
    authLink.href = "/dashboard/logout";
  }

  // --- Mark current page ---
  var current = window.location.pathname.replace(/\/$/, "") || "/";
  var links = document.querySelectorAll(".site-nav .nav-center a");
  for (var i = 0; i < links.length; i++) {
    var href = (links[i].getAttribute("href") || "").replace(/\/$/, "") || "/";
    if (href === current || (href !== "/" && current.indexOf(href) === 0)) {
      links[i].setAttribute("aria-current", "page");
    }
  }

  // --- Hamburger menu ---
  var nav = document.querySelector(".site-nav");
  var toggle = document.getElementById("nav-toggle");
  if (!nav || !toggle) return;

  function openMenu() {
    nav.classList.add("open");
    toggle.setAttribute("aria-expanded", "true");
  }
  function closeMenu() {
    nav.classList.remove("open");
    toggle.setAttribute("aria-expanded", "false");
  }
  function isOpen() { return nav.classList.contains("open"); }

  toggle.addEventListener("click", function (e) {
    e.stopPropagation();
    if (isOpen()) closeMenu();
    else openMenu();
  });

  // Escape key closes menu, returns focus to toggle
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && isOpen()) {
      closeMenu();
      toggle.focus();
    }
  });

  // Click outside closes menu
  document.addEventListener("click", function (e) {
    if (isOpen() && !nav.contains(e.target)) closeMenu();
  });

  // Close menu on resize past desktop breakpoint
  var resizeTimer;
  window.addEventListener("resize", function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (window.innerWidth > 860 && isOpen()) closeMenu();
    }, 100);
  });
})();
