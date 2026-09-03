/*
 * Copyright 2026 Demo AI Site
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.IntStream;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class MarqueeTickerModel {

    private static final int DEFAULT_COUNT = 12;
    private static final int MIN_COUNT = 1;
    private static final int MAX_COUNT = 30;

    @ValueMapValue
    private String phrase;

    @ValueMapValue
    private String iconPath;

    @ValueMapValue
    private String iconAlt;

    @ValueMapValue
    @Default(intValues = DEFAULT_COUNT)
    private int count;

    public String getPhrase() { return phrase; }
    public String getIconPath() { return iconPath; }
    public String getIconAlt() { return iconAlt == null ? "" : iconAlt; }

    public List<Integer> getItems() {
        int clamped = Math.max(MIN_COUNT, Math.min(MAX_COUNT, count > 0 ? count : DEFAULT_COUNT));
        return Collections.unmodifiableList(IntStream.range(0, clamped).boxed().collect(Collectors.toList()));
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(phrase);
    }
}
