package com.demo.core.models.ogs;

public class OgsNavItem {

    private final String label;
    private final String link;
    private final boolean active;

    public OgsNavItem(String label, String link, boolean active) {
        this.label = label;
        this.link = link;
        this.active = active;
    }

    public String getLabel() {
        return label;
    }

    public String getLink() {
        return link;
    }

    public boolean isActive() {
        return active;
    }
}
