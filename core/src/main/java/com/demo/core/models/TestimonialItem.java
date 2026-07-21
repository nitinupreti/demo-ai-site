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
 * Child item model for a single client testimonial within the Testimonial component's multifield.
 */
@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class TestimonialItem {

    @ValueMapValue
    private String jobRole;

    @ValueMapValue
    private String location;

    @ValueMapValue
    private String citation;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String name;

    @ValueMapValue
    private Integer age;

    public String getJobRole() {
        return jobRole;
    }

    public String getLocation() {
        return location;
    }

    public String getCitation() {
        return citation;
    }

    public String getImage() {
        return image;
    }

    public String getName() {
        return name;
    }

    public Integer getAge() {
        return age;
    }

    /**
     * @return {@code true} when the testimonial has all the required fields authored.
     */
    public boolean hasContent() {
        return isNotBlank(jobRole)
                && isNotBlank(location)
                && isNotBlank(citation)
                && isNotBlank(image)
                && isNotBlank(name);
    }

    private static boolean isNotBlank(String value) {
        return value != null && !value.isEmpty();
    }

}
