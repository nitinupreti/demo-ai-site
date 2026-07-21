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
 * Child item model for a single CTA button within the Tile component's CTA multifield.
 */
@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class CtaButton {

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

    /**
     * @return {@code true} when the CTA has both a label and a link and should be rendered.
     */
    public boolean hasContent() {
        return ctaTitle != null && !ctaTitle.isEmpty()
                && ctaLink != null && !ctaLink.isEmpty();
    }

}
