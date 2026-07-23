/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model backing the {@code hero-teaser} component.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroTeaserModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String subtitle;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    @Default(values = "mint")
    private String bgStyle;

    @ChildResource(name = "image")
    private Resource image;

    public String getTitle() {
        return title;
    }

    public String getSubtitle() {
        return subtitle;
    }

    public String getCtaLabel() {
        return ctaLabel;
    }

    public String getCtaLink() {
        return ctaLink;
    }

    public String getBgStyle() {
        return bgStyle;
    }

    public boolean isHasText() {
        return notBlank(title) || notBlank(subtitle) || notBlank(ctaLabel);
    }

    public boolean isHasImage() {
        return image != null
            && image.getValueMap().get("fileReference", String.class) != null;
    }

    public boolean isHasContent() {
        return isHasText() || isHasImage();
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
