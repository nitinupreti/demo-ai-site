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
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ImpactStripModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    @Default(values = "left")
    private String imageSide;

    @ChildResource
    private List<ImpactStatItemModel> stats;

    @PostConstruct
    protected void init() {
        if (stats == null) {
            stats = Collections.emptyList();
        } else {
            stats = stats.stream()
                    .filter(ImpactStatItemModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public String getEyebrow() { return eyebrow; }
    public String getTitle() { return title; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt; }
    public String getImageSide() { return imageSide; }
    public List<ImpactStatItemModel> getStats() { return Collections.unmodifiableList(stats); }

    public String getBackgroundStyle() {
        return StringUtils.isNotBlank(image) ? "background-image: url(" + image + ");" : null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title) || (stats != null && !stats.isEmpty());
    }
}
