/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class NewsletterSignupModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String icon;

    @ValueMapValue
    private String iconAlt;

    @ValueMapValue
    @Default(values = "alt")
    private String background;

    public String getEyebrow() { return eyebrow; }
    public String getDescription() { return description; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink; }
    public String getIcon() { return icon; }
    public String getIconAlt() { return iconAlt; }
    public String getBackground() { return background; }

    public boolean isHasContent() { return StringUtils.isNotBlank(eyebrow); }
}
