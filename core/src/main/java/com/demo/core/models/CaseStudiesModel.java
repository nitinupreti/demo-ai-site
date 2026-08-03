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
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CaseStudiesModel {

    @ChildResource
    private List<CaseStudyItem> items;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        if (items == null) items = new ArrayList<>();
        items.removeIf(i -> i == null || !i.isHasContent());
        hasContent = !items.isEmpty();
    }

    public List<CaseStudyItem> getItems() { return Collections.unmodifiableList(items); }
    public boolean isHasContent() { return hasContent; }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class CaseStudyItem {
        @ValueMapValue private String body;
        @ValueMapValue private String linkText;
        @ValueMapValue @Default(values = "#") private String linkPath;

        public String getBody() { return body; }
        public String getLinkText() { return linkText; }
        public String getLinkPath() { return linkPath; }

        public boolean isHasContent() { return StringUtils.isNotBlank(body); }
    }
}
