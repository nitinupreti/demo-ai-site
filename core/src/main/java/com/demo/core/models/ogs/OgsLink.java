package com.demo.core.models.ogs;

public class OgsLink {

    private final String label;
    private final String link;

    public OgsLink(String label, String link) {
        this.label = label;
        this.link = link;
    }

    public String getLabel() {
        return label;
    }

    public String getLink() {
        return link;
    }
}
