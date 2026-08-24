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

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class QuoteCarouselModel {

    @ChildResource
    private List<QuoteItemModel> quotes;

    @PostConstruct
    protected void init() {
        if (quotes == null) {
            quotes = Collections.emptyList();
        } else {
            quotes = quotes.stream()
                    .filter(QuoteItemModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public List<QuoteItemModel> getQuotes() { return Collections.unmodifiableList(quotes); }
    public boolean isHasContent() { return quotes != null && !quotes.isEmpty(); }
}
