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
 * Child item for {@code testimonial-carousel} — a single quote entry.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TestimonialItem {

    @ValueMapValue
    private String profession;

    @ValueMapValue
    private String location;

    @ValueMapValue
    private String quote;

    @ValueMapValue
    private String authorName;

    @ValueMapValue
    private String authorImage;

    public String getProfession() {
        return profession;
    }

    public String getLocation() {
        return location;
    }

    public String getQuote() {
        return quote;
    }

    public String getAuthorName() {
        return authorName;
    }

    public String getAuthorImage() {
        return authorImage;
    }

    public boolean isHasAuthorImage() {
        return authorImage != null && !authorImage.trim().isEmpty();
    }

    public boolean hasContent() {
        return notBlank(profession) || notBlank(quote) || notBlank(authorName);
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
