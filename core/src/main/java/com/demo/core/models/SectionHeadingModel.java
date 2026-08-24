/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class SectionHeadingModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String subheading;

    @ValueMapValue
    @Default(values = "center")
    private String align;

    @ValueMapValue
    @Default(values = "h2")
    private String level;

    public String getEyebrow() { return eyebrow; }
    public String getHeading() { return heading; }
    public String getSubheading() { return subheading; }
    public String getAlign() { return align; }
    public String getLevel() { return level; }

    public boolean isHasContent() { return StringUtils.isNotBlank(heading); }
}
