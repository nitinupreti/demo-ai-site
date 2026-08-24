/*
 * Copyright 2026 Demo AI Site
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroModel {

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String wordmark;

    @ValueMapValue
    private String videoSrc;

    @ValueMapValue
    private String fallbackImage;

    @ValueMapValue
    private String videoDescription;

    @ValueMapValue
    @Default(values = "au")
    private String style;

    @ValueMapValue
    @Default(values = "left")
    private String align;

    public String getHeading() { return heading; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink; }
    public String getWordmark() { return wordmark; }
    public String getVideoSrc() { return videoSrc; }
    public String getFallbackImage() { return fallbackImage; }
    public String getVideoDescription() { return videoDescription; }
    public String getStyle() { return style; }
    public String getAlign() { return align; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading)
            || StringUtils.isNotBlank(wordmark)
            || StringUtils.isNotBlank(videoSrc)
            || StringUtils.isNotBlank(fallbackImage);
    }
}
