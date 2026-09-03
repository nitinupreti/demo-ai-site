package com.demo.core.models.ogs;

public class OgsSocial {

    private final String label;
    private final String icon;
    private final String link;

    public OgsSocial(String label, String icon, String link) {
        this.label = label;
        this.icon = icon;
        this.link = link;
    }

    public String getLabel() {
        return label;
    }

    public String getIcon() {
        return icon;
    }

    public String getLink() {
        return link;
    }
}
