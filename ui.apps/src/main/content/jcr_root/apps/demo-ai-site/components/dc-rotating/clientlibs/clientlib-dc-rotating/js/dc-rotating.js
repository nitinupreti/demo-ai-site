(function () {
    'use strict';

    var SELECTOR = '[data-cmp-is="dc-rotating"]';
    var INITIALIZED_ATTR = 'data-cmp-initialized';
    var ROTATE_MS = 3000;

    function init(root) {
        if (root.getAttribute(INITIALIZED_ATTR) === 'true') { return; }
        root.setAttribute(INITIALIZED_ATTR, 'true');

        var items = root.querySelectorAll('.cmp-dc-rotating__item');
        var images = root.querySelectorAll('.cmp-dc-rotating__image');
        if (!items.length) { return; }

        var current = 0;

        function activate(idx) {
            items.forEach(function (el, i) {
                el.classList.toggle('cmp-dc-rotating__item--active', i === idx);
            });
            images.forEach(function (el, i) {
                el.classList.toggle('cmp-dc-rotating__image--active', i === idx);
            });
            current = idx;
        }

        var timer = setInterval(function () {
            activate((current + 1) % items.length);
        }, ROTATE_MS);

        items.forEach(function (el, i) {
            el.addEventListener('mouseenter', function () {
                clearInterval(timer);
                activate(i);
            });
            var link = el.querySelector('[data-cmp-hook-dc-rotating="link"]');
            if (link) {
                link.addEventListener('focus', function () {
                    clearInterval(timer);
                    activate(i);
                });
            }
        });
    }

    function onReady() {
        document.querySelectorAll(SELECTOR).forEach(init);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', onReady);
    } else {
        onReady();
    }
})();
