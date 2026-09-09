(() => {
    document.querySelectorAll('[data-cmp-is="hero"]').forEach((hero) => {
        if (hero.dataset.initialized === 'true') return;

        const trigger = hero.querySelector('.hero__video-trigger');
        const dialog = hero.querySelector('.hero__dialog');
        const video = hero.querySelector('.hero__video');
        const close = hero.querySelector('.hero__dialog-close');
        if (!trigger || !dialog || !video || !close) return;

        const closeDialog = () => {
            dialog.close();
            video.removeAttribute('src');
            trigger.focus();
        };

        trigger.addEventListener('click', () => {
            video.src = dialog.dataset.videoUrl;
            dialog.showModal();
        });
        close.addEventListener('click', closeDialog);
        dialog.addEventListener('click', (event) => {
            if (event.target === dialog) closeDialog();
        });
        dialog.addEventListener('cancel', (event) => {
            event.preventDefault();
            closeDialog();
        });
        hero.dataset.initialized = 'true';
    });
})();