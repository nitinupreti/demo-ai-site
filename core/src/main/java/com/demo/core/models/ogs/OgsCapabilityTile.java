package com.demo.core.models.ogs;

/**
 * Capability tile backing {@code ogs-capabilities}.
 */
public class OgsCapabilityTile {

    private final String label;
    private final String image;
    private final String hoverImage;

    public OgsCapabilityTile(String label, String image, String hoverImage) {
        this.label = label;
        this.image = image;
        this.hoverImage = hoverImage;
    }

    public String getLabel() {
        return label;
    }

    public String getImage() {
        return image;
    }

    public String getHoverImage() {
        return hoverImage;
    }
}
