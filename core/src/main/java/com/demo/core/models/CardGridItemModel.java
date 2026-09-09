package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CardGridItemModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String icon;

    @ValueMapValue
    private String tagline;

    @ValueMapValue
    private String meta;

    @ValueMapValue
    @Default(values = "right")
    private String imageSide;

    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt == null ? "" : imageAlt; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink == null ? "#" : ctaLink; }
    public String getIcon() { return icon; }
    public String getTagline() { return tagline; }
    public String getMeta() { return meta; }
    public String getImageSide() { return imageSide; }
    public boolean isHasContent() { return title != null || description != null || image != null; }
}
