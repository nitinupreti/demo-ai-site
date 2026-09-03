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
public class IndustriesModel {

    @ValueMapValue
    private String eyebrow;

    @ChildResource(name = "tiles")
    private List<Resource> tileResources;

    private List<IndustryTile> tiles;

    @PostConstruct
    protected void init() {
        tiles = new ArrayList<>();
        if (tileResources != null) {
            for (Resource r : tileResources) {
                IndustryTile t = r.adaptTo(IndustryTile.class);
                if (t != null && t.isHasContent()) tiles.add(t);
            }
        }
    }

    public String getEyebrow() { return eyebrow; }
    public List<IndustryTile> getTiles() { return Collections.unmodifiableList(tiles); }
    public boolean isHasContent() { return StringUtils.isNotBlank(eyebrow) || !tiles.isEmpty(); }
}
