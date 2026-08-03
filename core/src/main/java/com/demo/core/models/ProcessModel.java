/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ProcessModel {

    @ChildResource
    private List<ProcessStep> steps;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        if (steps == null) steps = new ArrayList<>();
        steps.removeIf(s -> s == null || !s.isHasContent());
        hasContent = !steps.isEmpty();
    }

    public List<ProcessStep> getSteps() { return Collections.unmodifiableList(steps); }
    public boolean isHasContent() { return hasContent; }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class ProcessStep {
        @ValueMapValue private String number;
        @ValueMapValue private String title;
        @ValueMapValue private String body;

        public String getNumber() { return number; }
        public String getTitle() { return title; }
        public String getBody() { return body; }

        public boolean isHasContent() { return StringUtils.isNotBlank(title) || StringUtils.isNotBlank(number); }
    }
}
