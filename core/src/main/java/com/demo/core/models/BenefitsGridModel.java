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
 * Sling Model backing the {@code benefits-grid} component.
 */
@Model(adaptables = Resource.class,
       defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class BenefitsGridModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String intro;

    @ChildResource(name = "callouts")
    private List<Resource> calloutResources;

    private List<CalloutItem> callouts = Collections.emptyList();

    @PostConstruct
    protected void init() {
        if (calloutResources == null || calloutResources.isEmpty()) {
            callouts = Collections.emptyList();
            return;
        }
        List<CalloutItem> out = new ArrayList<>(calloutResources.size());
        for (Resource child : calloutResources) {
            CalloutItem item = child.adaptTo(CalloutItem.class);
            if (item != null && item.hasContent()) {
                out.add(item);
            }
        }
        callouts = Collections.unmodifiableList(out);
    }

    public String getTitle() {
        return title;
    }

    public String getIntro() {
        return intro;
    }

    public List<CalloutItem> getCallouts() {
        return callouts;
    }

    public boolean isHasCallouts() {
        return !callouts.isEmpty();
    }

    public boolean isHasContent() {
        return notBlank(title) || notBlank(intro) || isHasCallouts();
    }

    private static boolean notBlank(String value) {
        return value != null && !value.trim().isEmpty();
    }
}
