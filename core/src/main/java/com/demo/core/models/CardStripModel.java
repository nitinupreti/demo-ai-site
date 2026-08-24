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
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CardStripModel {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    @Default(values = "light")
    private String background;

    @ChildResource
    private List<CardItemModel> cards;

    @PostConstruct
    protected void init() {
        if (cards == null) {
            cards = Collections.emptyList();
        } else {
            cards = cards.stream()
                    .filter(CardItemModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public String getEyebrow() { return eyebrow; }
    public String getBackground() { return background; }
    public List<CardItemModel> getCards() { return Collections.unmodifiableList(cards); }
    public boolean isHasContent() { return cards != null && !cards.isEmpty(); }
}
