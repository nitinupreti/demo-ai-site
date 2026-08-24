(function () {
    "use strict";

    var SELECTOR = '[data-cmp-is="hero-carousel"]';
    var ACTIVE_CLASS = "cmp-hero-carousel__slide--active";
    var AUTO_INTERVAL = 6000;

    function init(root) {
        if (root.dataset.cmpInitialized === "true") { return; }
        root.dataset.cmpInitialized = "true";

        var slides = root.querySelectorAll(".cmp-hero-carousel__slide");
        if (!slides.length) { return; }

        var counter = root.querySelector('[data-cmp-hook-hero-carousel="counter"]');
        var prev = root.querySelector('[data-cmp-hook-hero-carousel="prev"]');
        var next = root.querySelector('[data-cmp-hook-hero-carousel="next"]');
        var bgVideo = root.querySelector('[data-cmp-hook-hero-carousel="bg-video"]');
        var current = 0;
        var timer = null;
        var reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

        function pad(n) { return (n < 10 ? "0" : "") + n; }

        function go(index) {
            current = (index + slides.length) % slides.length;
            slides.forEach(function (s, i) {
                var active = i === current;
                s.classList.toggle(ACTIVE_CLASS, active);
                s.setAttribute("aria-hidden", active ? "false" : "true");
            });
            if (counter) {
                counter.innerHTML = pad(current + 1) + "&nbsp;/&nbsp;" + pad(slides.length);
            }
        }

        function schedule() {
            if (reduced) { return; }
            if (root.dataset.cmpAutoRotate !== "true") { return; }
            stop();
            timer = window.setTimeout(function () { go(current + 1); schedule(); }, AUTO_INTERVAL);
        }

        function stop() {
            if (timer) { window.clearTimeout(timer); timer = null; }
        }

        function setupBgVideo() {
            if (!bgVideo || reduced) { return; }
            var intro = bgVideo.getAttribute("data-src-intro");
            var loop = bgVideo.getAttribute("data-src-loop");
            var playedIntro = false;
            function playSrc(src, isLoop) {
                if (!src) { return; }
                bgVideo.loop = !!isLoop;
                bgVideo.src = src;
                bgVideo.load();
                var p = bgVideo.play();
                if (p && p.catch) { p.catch(function () { bgVideo.setAttribute("data-paused", "true"); }); }
            }
            bgVideo.addEventListener("ended", function () {
                if (!playedIntro && loop) {
                    playedIntro = true;
                    playSrc(loop, true);
                }
            });
            if (intro) {
                playSrc(intro, false);
            } else if (loop) {
                playSrc(loop, true);
            }
        }

        if (prev) { prev.addEventListener("click", function () { go(current - 1); schedule(); }); }
        if (next) { next.addEventListener("click", function () { go(current + 1); schedule(); }); }

        root.addEventListener("mouseenter", stop);
        root.addEventListener("mouseleave", schedule);
        root.addEventListener("focusin", stop);
        root.addEventListener("focusout", schedule);

        go(0);
        schedule();
        setupBgVideo();
    }

    function initAll() {
        document.querySelectorAll(SELECTOR).forEach(init);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initAll);
    } else {
        initAll();
    }
})();
