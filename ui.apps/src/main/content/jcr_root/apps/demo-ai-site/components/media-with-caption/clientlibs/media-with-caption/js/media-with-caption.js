(() => {
    const selector = '[data-cmp-is="media-with-caption"] .media-with-caption__video';

    function initializeVideo(video) {
        if (video.dataset.inlineVideoReady) {
            return;
        }

        video.dataset.inlineVideoReady = 'true';
        video.autoplay = true;
        video.loop = true;
        video.muted = true;
        video.playsInline = true;
        video.preload = 'auto';

        const play = () => {
            const playback = video.play();
            if (playback) {
                playback.catch(() => {});
            }
        };

        play();
    }

    function initialize() {
        document.querySelectorAll(selector).forEach(initializeVideo);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }
})();