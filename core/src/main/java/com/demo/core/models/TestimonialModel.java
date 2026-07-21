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

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model for the Testimonial component. Exposes the section title and the list of
 * authored testimonial items to the HTL template.
 */
@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class TestimonialModel {

    @ValueMapValue
    private String title;

    @ChildResource(name = "testimonials")
    private List<Resource> testimonialResources;

    private List<TestimonialItem> testimonials;

    @PostConstruct
    protected void init() {
        List<TestimonialItem> items = new ArrayList<>();
        if (testimonialResources != null) {
            for (Resource itemResource : testimonialResources) {
                TestimonialItem item = itemResource.adaptTo(TestimonialItem.class);
                if (item != null && item.hasContent()) {
                    items.add(item);
                }
            }
        }
        this.testimonials = Collections.unmodifiableList(items);
    }

    public String getTitle() {
        return title;
    }

    public List<TestimonialItem> getTestimonials() {
        return testimonials;
    }

    /**
     * @return {@code true} when the component has enough authored data to render.
     */
    public boolean isHasContent() {
        return title != null && !title.isEmpty() && !testimonials.isEmpty();
    }

}
