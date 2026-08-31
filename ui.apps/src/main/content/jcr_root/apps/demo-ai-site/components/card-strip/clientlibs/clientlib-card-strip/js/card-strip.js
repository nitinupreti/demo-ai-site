(function () {
    "use strict";

    function init(root) {
        if (root.dataset.cmpInitialized === "true") { return; }
        root.dataset.cmpInitialized = "true";

        var list = root.querySelector(".cmp-card-strip__list");
        var items = root.querySelectorAll(".cmp-card-strip__item");
        var previous = root.querySelector('[data-cmp-hook-card-strip="prev"]');
        var next = root.querySelector('[data-cmp-hook-card-strip="next"]');
        var counter = root.querySelector('[data-cmp-hook-card-strip="counter"]');
        var current = items.length > 1 ? 1 : 0;

        function render() {
            list.style.transform = "translateX(calc(-1 * " + current + " * var(--das-news-item-step)))";
            if (counter) { counter.textContent = current + " / " + items.length; }
        }

        function move(offset) {
            current = (current + offset + items.length) % items.length;
            render();
        }

        if (previous) { previous.addEventListener("click", function () { move(-1); }); }
        if (next) { next.addEventListener("click", function () { move(1); }); }
        render();
    }

    function initAll() {
        document.querySelectorAll('[data-cmp-is="card-strip"]').forEach(init);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAll);
    } else {
        initAll();
    }
}());
