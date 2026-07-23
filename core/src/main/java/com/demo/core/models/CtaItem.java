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
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Child item for {@code service-card}'s CTA Buttons multifield.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CtaItem {

    @ValueMapValue
    private String ctaTitle;

    @ValueMapValue
    private String ctaLink;

    public String getCtaTitle() {
        return ctaTitle;
    }

    public String getCtaLink() {
        return ctaLink;
    }

    public boolean hasContent() {
        return notBlank(ctaTitle) && notBlank(ctaLink);
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
