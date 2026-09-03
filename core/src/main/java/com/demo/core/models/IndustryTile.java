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
public class IndustryTile {

    @ValueMapValue
    private String label;

    @ValueMapValue
    private String linkPath;

    @ValueMapValue
    private String iconAlt;

    public String getLabel() { return label; }
    public String getIconAlt() { return iconAlt == null ? "" : iconAlt; }

    public String getHref() {
        if (StringUtils.isBlank(linkPath)) return null;
        if (linkPath.startsWith("/content") && !linkPath.contains(".")) return linkPath + ".html";
        return linkPath;
    }

    public boolean isHasContent() { return StringUtils.isNotBlank(label); }
}
