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
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model backing the {@code section-intro} component.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SectionIntroModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String subtitle;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    @Default(values = "center")
    private String align;

    @ValueMapValue
    @Default(values = "light")
    private String theme;

    public String getEyebrow() {
        return eyebrow;
    }

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

    public String getAlign() {
        return align;
    }

    public String getTheme() {
        return theme;
    }

    public boolean isHasText() {
        return notBlank(eyebrow) || notBlank(title) || notBlank(subtitle) || notBlank(ctaLabel);
    }

    public boolean isHasContent() {
        return isHasText();
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
