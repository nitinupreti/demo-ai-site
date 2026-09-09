(() => {
    document.querySelectorAll('[data-cmp-is="site-header"]').forEach((header) => {
        if (header.dataset.initialized === 'true') return;

        const root = header.closest('.site-header');
        const menu = header.querySelector('.site-header__menu');
        if (!root || !menu) return;

        menu.addEventListener('click', () => {
            const open = root.classList.toggle('site-header--open');
            menu.setAttribute('aria-expanded', String(open));
        });
        header.dataset.initialized = 'true';
    });
})();