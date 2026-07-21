/*
 * Testimonial component behavior.
 * Wires up the left column tabs to switch which quote panel is visible.
 */
(function () {
    "use strict";

    var SELECTOR_ROOT = '[data-cmp-is="testimonial"]';
    var SELECTOR_TAB = ".cmp-testimonial__tab";
    var SELECTOR_PANEL = ".cmp-testimonial__panel";
    var CLASS_TAB_ACTIVE = "cmp-testimonial__tab--active";
    var CLASS_PANEL_ACTIVE = "cmp-testimonial__panel--active";

    function activate(root, index) {
        var tabs = root.querySelectorAll(SELECTOR_TAB);
        var panels = root.querySelectorAll(SELECTOR_PANEL);
        for (var i = 0; i < tabs.length; i++) {
            var active = i === index;
            tabs[i].classList.toggle(CLASS_TAB_ACTIVE, active);
            tabs[i].setAttribute("aria-selected", active ? "true" : "false");
        }
        for (var j = 0; j < panels.length; j++) {
            var panelActive = j === index;
            panels[j].classList.toggle(CLASS_PANEL_ACTIVE, panelActive);
            if (panelActive) {
                panels[j].removeAttribute("hidden");
            } else {
                panels[j].setAttribute("hidden", "hidden");
            }
        }
    }

    function init(root) {
        var tabs = root.querySelectorAll(SELECTOR_TAB);
        for (var i = 0; i < tabs.length; i++) {
            (function (tab) {
                tab.addEventListener("click", function () {
                    var idx = parseInt(tab.getAttribute("data-cmp-testimonial-index"), 10);
                    if (!isNaN(idx)) {
                        activate(root, idx);
                    }
                });
            })(tabs[i]);
        }
    }

    function onDocumentReady() {
        var roots = document.querySelectorAll(SELECTOR_ROOT);
        for (var i = 0; i < roots.length; i++) {
            init(roots[i]);
        }
    }

    if (document.readyState !== "loading") {
        onDocumentReady();
    } else {
        document.addEventListener("DOMContentLoaded", onDocumentReady);
    }
})();
