/*
 *  Copyright 2026 Adobe Systems Incorporated
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Child item model for a single benefit call-out within the Benefit component's multifield.
 */
@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class BenefitItem {

    @ValueMapValue
    private String icon;

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    public String getIcon() {
        return icon;
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    /**
     * @return {@code true} when the benefit item has all the required fields authored.
     */
    public boolean hasContent() {
        return isNotBlank(icon) && isNotBlank(title) && isNotBlank(description);
    }

    private static boolean isNotBlank(String value) {
        return value != null && !value.isEmpty();
    }

}
