/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class PartnerLogosModel {

    @ValueMapValue
    private String heading;

    @ChildResource
    private List<PartnerLogoItemModel> logos;

    @PostConstruct
    protected void init() {
        if (logos == null) {
            logos = Collections.emptyList();
        } else {
            logos = logos.stream()
                    .filter(PartnerLogoItemModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public String getHeading() { return heading; }
    public List<PartnerLogoItemModel> getLogos() { return Collections.unmodifiableList(logos); }
    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading) || (logos != null && !logos.isEmpty());
    }
}
