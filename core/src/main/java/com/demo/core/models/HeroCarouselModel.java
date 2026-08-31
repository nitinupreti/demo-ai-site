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

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;
import org.apache.sling.models.annotations.Default;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class HeroCarouselModel {

    @ValueMapValue
    @Default(booleanValues = true)
    private boolean autoRotate;

    @ValueMapValue
    @Default(values = "dark")
    private String theme;

    @ValueMapValue
    @Default(values = "default")
    private String style;

    @ChildResource
    private List<HeroCarouselSlideModel> slides;

    @PostConstruct
    protected void init() {
        if (slides == null) {
            slides = Collections.emptyList();
        } else {
            slides = slides.stream()
                    .filter(HeroCarouselSlideModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public boolean isAutoRotate() {
        return autoRotate;
    }

    public String getTheme() {
        return theme;
    }

    public String getStyle() {
        return style;
    }

    public List<HeroCarouselSlideModel> getSlides() {
        return Collections.unmodifiableList(slides);
    }

    public HeroCarouselSlideModel getFirstSlide() {
        return slides.isEmpty() ? null : slides.get(0);
    }

    public boolean isHasBgVideo() {
        return !slides.isEmpty() && slides.get(0).isHasBgVideo();
    }

    public boolean isHasContent() {
        return slides != null && !slides.isEmpty();
    }
}
