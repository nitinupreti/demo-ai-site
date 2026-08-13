/*
 * Hero component script — idempotent init.
 * Currently minimal: emits an initialization marker so multiple instances stay independent.
 */
(function () {
    "use strict";

    var SELECTOR = "[data-cmp-is='hero']";
    var INITIALIZED = "data-cmp-hero-initialized";

    function init(root) {
        if (root.hasAttribute(INITIALIZED)) {
            return;
        }
        root.setAttribute(INITIALIZED, "true");

        // Reserved for future carousel/video-modal wiring; scoped to root only.
    }

    function initAll() {
        var roots = document.querySelectorAll(SELECTOR);
        for (var i = 0; i < roots.length; i++) {
            init(roots[i]);
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAll);
    } else {
        initAll();
    }
})();
