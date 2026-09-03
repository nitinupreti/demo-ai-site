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
public class ServiceCard {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String linkPath;

    @ChildResource(name = "links")
    private List<Resource> linkResources;

    private List<ServiceSubLink> links;

    @PostConstruct
    protected void init() {
        links = new ArrayList<>();
        if (linkResources != null) {
            for (Resource r : linkResources) {
                ServiceSubLink l = r.adaptTo(ServiceSubLink.class);
                if (l != null && l.isHasContent()) links.add(l);
            }
        }
    }

    public String getTitle() { return title; }

    public String getHref() {
        if (StringUtils.isBlank(linkPath)) return null;
        if (linkPath.startsWith("/content") && !linkPath.contains(".")) return linkPath + ".html";
        return linkPath;
    }

    public List<ServiceSubLink> getLinks() { return Collections.unmodifiableList(links); }

    public boolean isHasContent() { return StringUtils.isNotBlank(title); }
}
