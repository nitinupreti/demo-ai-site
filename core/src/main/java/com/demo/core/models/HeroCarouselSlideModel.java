/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroCarouselSlideModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String bgVideo;

    @ValueMapValue
    private String bgVideoLoop;

    public String getEyebrow() { return eyebrow; }
    public String getTitle() { return title; }
    public String getDescription() { return description; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt; }
    public String getBgVideo() { return bgVideo; }
    public String getBgVideoLoop() { return bgVideoLoop; }

    public boolean isHasBgVideo() {
        return StringUtils.isNotBlank(bgVideo) || StringUtils.isNotBlank(bgVideoLoop);
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title)
                || StringUtils.isNotBlank(description)
                || StringUtils.isNotBlank(ctaLabel)
                || StringUtils.isNotBlank(image)
                || StringUtils.isNotBlank(bgVideo)
                || StringUtils.isNotBlank(bgVideoLoop);
    }
}
