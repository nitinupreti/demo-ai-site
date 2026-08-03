/*
 * Positivus Process accordion — one panel expanded at a time.
 * Scoped to each component root so multiple instances co-exist.
 */
(function () {
    'use strict';

    function initInstance(root) {
        if (root.getAttribute('data-cmp-initialized') === 'true') {
            return;
        }
        root.setAttribute('data-cmp-initialized', 'true');

        var items = root.querySelectorAll('.cmp-pos-process__item');
        items.forEach(function (item) {
            var header = item.querySelector('.cmp-pos-process__header');
            if (!header) return;
            header.addEventListener('click', function () {
                var isActive = item.classList.contains('cmp-pos-process__item--active');
                items.forEach(function (i) {
                    i.classList.remove('cmp-pos-process__item--active');
                    var h = i.querySelector('.cmp-pos-process__header');
                    if (h) h.setAttribute('aria-expanded', 'false');
                });
                if (!isActive) {
                    item.classList.add('cmp-pos-process__item--active');
                    header.setAttribute('aria-expanded', 'true');
                }
            });
        });
    }

    function init() {
        var roots = document.querySelectorAll('[data-cmp-is="pos-process"]');
        roots.forEach(initInstance);
    }

    if (document.readyState !== 'loading') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
