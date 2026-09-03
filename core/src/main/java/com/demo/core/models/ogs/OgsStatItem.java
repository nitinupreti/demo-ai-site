package com.demo.core.models.ogs;

/**
 * Simple value+label stat row backing {@code ogs-stats}.
 */
public class OgsStatItem {

    private final String value;
    private final String label;

    public OgsStatItem(String value, String label) {
        this.value = value;
        this.label = label;
    }

    public String getValue() {
        return value;
    }

    public String getLabel() {
        return label;
    }
}
