(function () {
    'use strict';

    var SELECTOR = '[data-cmp-is="hero"]';
    var INITIALIZED_ATTR = 'data-cmp-initialized';

    function init(root) {
        if (root.getAttribute(INITIALIZED_ATTR) === 'true') { return; }
        root.setAttribute(INITIALIZED_ATTR, 'true');

        var video = root.querySelector('.cmp-hero__video');
        var pauseBtn = root.querySelector('[data-cmp-hook-hero="pause"]');
        if (!video || !pauseBtn) { return; }

        // Some browsers block autoplay even when muted; force-start once ready.
        var tryPlay = function () {
            var p = video.play();
            if (p && typeof p.then === 'function') {
                p.catch(function () {
                    root.setAttribute('data-hero-paused', 'true');
                });
            }
        };
        if (video.readyState >= 2) { tryPlay(); }
        else { video.addEventListener('loadeddata', tryPlay, { once: true }); }

        pauseBtn.addEventListener('click', function () {
            if (video.paused) {
                video.play();
                root.setAttribute('data-hero-paused', 'false');
                pauseBtn.setAttribute('aria-label', 'Pause background video');
            } else {
                video.pause();
                root.setAttribute('data-hero-paused', 'true');
                pauseBtn.setAttribute('aria-label', 'Play background video');
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
