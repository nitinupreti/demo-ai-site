/*
 * Tile dialog client library.
 *
 * Shows the "Custom Background Hex Code" text field only when the "Background Color"
 * dropdown value equals "other". Otherwise the hex field is hidden AND its value cleared
 * so authors don't accidentally leave stale hex values behind that override the preset.
 */
(function (document, $) {
    "use strict";

    var BG_SELECT_SELECTOR = ".cmp-tile-dialog__background-color";
    var HEX_FIELD_SELECTOR = ".cmp-tile-dialog__background-color-hex";
    var OTHER_VALUE = "other";

    function toggleHexField($select, $hexField) {
        var value = $select.val();
        var $wrapper = $hexField.closest(".coral-Form-fieldwrapper");
        var target = $wrapper.length ? $wrapper : $hexField;

        if (value === OTHER_VALUE) {
            target.show();
        } else {
            target.hide();
            // clear so an old hex value doesn't leak back if the author switches away and saves
            $hexField.val("");
            var hexInput = $hexField.get(0);
            if (hexInput && typeof hexInput.value !== "undefined") {
                hexInput.value = "";
            }
        }
    }

    $(document).on("dialog-ready foundation-contentloaded", function () {
        var $dialog = $(document);
        var $select = $dialog.find(BG_SELECT_SELECTOR);
        var $hexField = $dialog.find(HEX_FIELD_SELECTOR);

        if (!$select.length || !$hexField.length) {
            return;
        }

        toggleHexField($select, $hexField);

        $select.off("change.cmpTileDialog").on("change.cmpTileDialog", function () {
            toggleHexField($select, $hexField);
        });
    });
})(document, Granite.$);
