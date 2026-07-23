(function () {
    'use strict';

    var SELECTORS = {
        root: '[data-cmp-is="testimonial-carousel"]',
        tabs: '.cmp-testimonial-carousel__tab',
        tabButton: '.cmp-testimonial-carousel__tab-button',
        quotes: '.cmp-testimonial-carousel__quote'
    };

    var CLASSES = {
        activeTab: 'cmp-testimonial-carousel__tab--active',
        activeQuote: 'cmp-testimonial-carousel__quote--active'
    };

    function activate(root, index) {
        var tabs = root.querySelectorAll(SELECTORS.tabs);
        var quotes = root.querySelectorAll(SELECTORS.quotes);
        tabs.forEach(function (tab, i) {
            tab.classList.toggle(CLASSES.activeTab, i === index);
            var btn = tab.querySelector(SELECTORS.tabButton);
            if (btn) {
                btn.setAttribute('aria-selected', i === index ? 'true' : 'false');
            }
        });
        quotes.forEach(function (quote, i) {
            quote.classList.toggle(CLASSES.activeQuote, i === index);
        });
    }

    function init(root) {
        if (root.dataset.cmpInitialized === 'true') {
            return;
        }
        root.dataset.cmpInitialized = 'true';
        var buttons = root.querySelectorAll(SELECTORS.tabButton);
        buttons.forEach(function (btn) {
            btn.addEventListener('click', function () {
                var idx = parseInt(btn.getAttribute('data-index'), 10);
                if (!isNaN(idx)) {
                    activate(root, idx);
                }
            });
        });
    }

    function initAll() {
        document.querySelectorAll(SELECTORS.root).forEach(init);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initAll);
    } else {
        initAll();
    }
})();
