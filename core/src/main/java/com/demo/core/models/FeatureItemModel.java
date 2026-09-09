package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FeatureItemModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String imageSide;

    private String effectiveImageSide = "right";

    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt == null ? "" : imageAlt; }
    public String getImageSide() { return imageSide; }
    public String getEffectiveImageSide() { return effectiveImageSide; }

    void applyAutoSide(int index) {
        if (imageSide != null && !imageSide.isEmpty()) {
            effectiveImageSide = imageSide;
        } else {
            effectiveImageSide = (index % 2 == 0) ? "right" : "left";
        }
    }

    public boolean isHasContent() {
        return (title != null && !title.isEmpty()) || (description != null && !description.isEmpty());
    }
}
