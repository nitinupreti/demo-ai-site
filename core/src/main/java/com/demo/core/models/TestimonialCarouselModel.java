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
 * Sling Model backing the {@code testimonial-carousel} component.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TestimonialCarouselModel {

    @ValueMapValue
    private String title;

    @ChildResource(name = "items")
    private List<Resource> itemResources;

    private List<TestimonialItem> items = Collections.emptyList();

    @PostConstruct
    protected void init() {
        if (itemResources == null || itemResources.isEmpty()) {
            items = Collections.emptyList();
            return;
        }
        List<TestimonialItem> out = new ArrayList<>(itemResources.size());
        for (Resource child : itemResources) {
            TestimonialItem item = child.adaptTo(TestimonialItem.class);
            if (item != null && item.hasContent()) {
                out.add(item);
            }
        }
        items = Collections.unmodifiableList(out);
    }

    public String getTitle() {
        return title;
    }

    public List<TestimonialItem> getItems() {
        return items;
    }

    public boolean isHasItems() {
        return !items.isEmpty();
    }

    public boolean isHasContent() {
        return (title != null && !title.trim().isEmpty()) || isHasItems();
    }
}
