/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class PartnerLogoItemModel {

    @ValueMapValue
    private String name;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String link;

    public String getName() { return name; }
    public String getImage() { return image; }
    public String getLink() { return link; }

    public boolean isHasContent() { return StringUtils.isNotBlank(name); }
}
