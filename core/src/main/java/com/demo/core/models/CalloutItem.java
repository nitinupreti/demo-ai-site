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
 * Child item for {@code benefits-grid}'s callouts multifield.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CalloutItem {

    @ValueMapValue
    private String icon;

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String calloutTitle;

    @ValueMapValue
    private String description;

    public String getIcon() {
        return icon;
    }

    public String getEyebrow() {
        return eyebrow;
    }

    public String getCalloutTitle() {
        return calloutTitle;
    }

    public String getDescription() {
        return description;
    }

    public boolean isHasIcon() {
        return icon != null && !icon.trim().isEmpty();
    }

    public boolean hasContent() {
        return notBlank(eyebrow) || notBlank(calloutTitle) || notBlank(description) || isHasIcon();
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
