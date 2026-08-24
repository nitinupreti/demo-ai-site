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
public class ProductCardsModel {

    @ValueMapValue
    @Default(values = "3")
    private String columns;

    @ChildResource
    private List<ProductCardItemModel> cards;

    @PostConstruct
    protected void init() {
        if (cards == null) {
            cards = Collections.emptyList();
        } else {
            cards = cards.stream()
                    .filter(ProductCardItemModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public String getColumns() { return columns; }
    public List<ProductCardItemModel> getCards() { return Collections.unmodifiableList(cards); }
    public boolean isHasContent() { return cards != null && !cards.isEmpty(); }
}
