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
public class FeaturedCaseStudyModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String category;

    @ValueMapValue
    private String linkPath;

    @ValueMapValue
    private String posterAlt;

    @ValueMapValue
    private String posterImage;

    @ValueMapValue
    private String readOnLabel;

    @ValueMapValue
    private String viewAllLabel;

    @ValueMapValue
    private String viewAllLink;

    public String getEyebrow() { return eyebrow; }
    public String getHeading() { return heading; }
    public String getCategory() { return category; }
    public String getPosterImage() { return posterImage; }
    public String getViewAllLabel() { return viewAllLabel; }

    public String getViewAllHref() {
        if (StringUtils.isBlank(viewAllLink)) return null;
        if (viewAllLink.startsWith("/content") && !viewAllLink.contains(".")) return viewAllLink + ".html";
        return viewAllLink;
    }

    public String getPosterAlt() { return StringUtils.defaultIfBlank(posterAlt, "Video poster"); }

    public String getReadOnLabel() { return StringUtils.defaultIfBlank(readOnLabel, "Read on"); }

    public String getHref() {
        if (StringUtils.isBlank(linkPath)) return null;
        if (linkPath.startsWith("/content") && !linkPath.contains(".")) return linkPath + ".html";
        return linkPath;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading) || StringUtils.isNotBlank(eyebrow);
    }
}
