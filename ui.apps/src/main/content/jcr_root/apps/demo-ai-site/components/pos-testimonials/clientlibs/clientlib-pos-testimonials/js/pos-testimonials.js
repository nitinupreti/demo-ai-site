/*
 * Positivus Testimonials carousel — scroll the track by one slide on nav click.
 */
(function () {
    'use strict';

    function initInstance(root) {
        if (root.getAttribute('data-cmp-initialized') === 'true') return;
        root.setAttribute('data-cmp-initialized', 'true');

        var track = root.querySelector('.cmp-pos-testimonials__track');
        var prev = root.querySelector('.cmp-pos-testimonials__nav--prev');
        var next = root.querySelector('.cmp-pos-testimonials__nav--next');
        if (!track) return;

        function step() {
            var slide = track.querySelector('.cmp-pos-testimonials__slide');
            if (!slide) return 400;
            var style = window.getComputedStyle(track);
            var gap = parseInt(style.columnGap || style.gap || '0', 10);
            return slide.getBoundingClientRect().width + (isNaN(gap) ? 0 : gap);
        }

        if (prev) prev.addEventListener('click', function () {
            track.scrollBy({ left: -step(), behavior: 'smooth' });
        });
        if (next) next.addEventListener('click', function () {
            track.scrollBy({ left: step(), behavior: 'smooth' });
        });
    }

    function init() {
        document.querySelectorAll('[data-cmp-is="pos-testimonials"]').forEach(initInstance);
    }

    if (document.readyState !== 'loading') {
        init();
    } else {
        document.addEventListener('DOMContentLoaded', init);
    }
})();
