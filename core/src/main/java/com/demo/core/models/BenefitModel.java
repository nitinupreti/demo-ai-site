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
 * Sling Model for the Benefit component. Exposes the section title, description and the list of
 * authored benefit call-outs to the HTL template.
 */
@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class BenefitModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String description;

    @ChildResource(name = "benefitContent")
    private List<Resource> benefitResources;

    private List<BenefitItem> benefits;

    @PostConstruct
    protected void init() {
        List<BenefitItem> items = new ArrayList<>();
        if (benefitResources != null) {
            for (Resource itemResource : benefitResources) {
                BenefitItem item = itemResource.adaptTo(BenefitItem.class);
                if (item != null && item.hasContent()) {
                    items.add(item);
                }
            }
        }
        this.benefits = Collections.unmodifiableList(items);
    }

    public String getTitle() {
        return title;
    }

    public String getDescription() {
        return description;
    }

    public List<BenefitItem> getBenefits() {
        return benefits;
    }

    /**
     * @return {@code true} when the component has enough authored data to render.
     */
    public boolean isHasContent() {
        return title != null && !title.isEmpty()
                && description != null && !description.isEmpty()
                && !benefits.isEmpty();
    }

}
