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
public class QuoteItemModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String quote;

    @ValueMapValue
    private String attribution;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    public String getTitle() { return title; }
    public String getQuote() { return quote; }
    public String getAttribution() { return attribution; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt; }

    public boolean isHasContent() { return StringUtils.isNotBlank(quote); }
}
