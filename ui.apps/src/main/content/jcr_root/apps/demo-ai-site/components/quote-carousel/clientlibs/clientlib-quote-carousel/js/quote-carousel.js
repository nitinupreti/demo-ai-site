(function () {
    "use strict";

    var SELECTOR = '[data-cmp-is="quote-carousel"]';
    var ACTIVE = "cmp-quote-carousel__slide--active";

    function init(root) {
        if (root.dataset.cmpInitialized === "true") { return; }
        root.dataset.cmpInitialized = "true";

        var slides = root.querySelectorAll(".cmp-quote-carousel__slide");
        var dots   = root.querySelectorAll('[data-cmp-hook-quote-carousel="dot"]');
        if (!slides.length) { return; }

        function go(index) {
            slides.forEach(function (s, i) {
                var active = i === index;
                s.classList.toggle(ACTIVE, active);
                s.setAttribute("aria-hidden", active ? "false" : "true");
            });
            dots.forEach(function (d, i) { d.setAttribute("aria-current", i === index ? "true" : "false"); });
        }

        dots.forEach(function (dot, i) {
            dot.addEventListener("click", function () { go(i); });
        });
    }

    function initAll() { document.querySelectorAll(SELECTOR).forEach(init); }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAll);
    } else {
        initAll();
    }
})();
