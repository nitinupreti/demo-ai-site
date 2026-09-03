/*
 * Copyright 2026 Demo AI Site
 * Licensed under the Apache License, Version 2.0.
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class InsightCard {

    @ValueMapValue
    private String imagePath;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String category;

    @ValueMapValue
    private String linkPath;

    public String getImagePath() { return imagePath; }
    public String getImageAlt() { return imageAlt == null ? "" : imageAlt; }
    public String getHeading() { return heading; }
    public String getCategory() { return category; }

    public String getHref() {
        if (StringUtils.isBlank(linkPath)) return null;
        if (linkPath.startsWith("/content") && !linkPath.contains(".")) return linkPath + ".html";
        return linkPath;
    }

    public boolean isHasContent() { return StringUtils.isNotBlank(heading); }
}
