package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class OgsMediaBandModel {

    @ValueMapValue
    private String imagePath;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String overlayTitle;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String ctaLabel;

    public String getImagePath() {
        return imagePath;
    }

    public String getImageAlt() {
        return imageAlt;
    }

    public String getOverlayTitle() {
        return overlayTitle;
    }

    public String getCtaLink() {
        return ctaLink;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }
}
