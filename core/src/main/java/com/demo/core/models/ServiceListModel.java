/*
 * Copyright 2026 Demo AI Site
 * Licensed under the Apache License, Version 2.0.
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
public class ServiceListModel {

    @ValueMapValue
    private String eyebrow;

    @ChildResource(name = "services")
    private List<Resource> serviceResources;

    private List<ServiceCard> services;

    @PostConstruct
    protected void init() {
        services = new ArrayList<>();
        if (serviceResources != null) {
            for (Resource r : serviceResources) {
                ServiceCard c = r.adaptTo(ServiceCard.class);
                if (c != null && c.isHasContent()) services.add(c);
            }
        }
    }

    public String getEyebrow() { return eyebrow; }
    public List<ServiceCard> getServices() { return Collections.unmodifiableList(services); }
    public boolean isHasContent() { return StringUtils.isNotBlank(eyebrow) || !services.isEmpty(); }
}
