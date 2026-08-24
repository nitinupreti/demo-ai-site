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
public class ArticleCarouselModel {

    @ValueMapValue
    private String heading;

    @ValueMapValue
    private String headingEmphasis;

    @ChildResource
    private QuoteItemModel featured;

    @ChildResource
    private List<CardItemModel> articles;

    @PostConstruct
    protected void init() {
        if (articles == null) {
            articles = Collections.emptyList();
        } else {
            articles = articles.stream()
                    .filter(CardItemModel::isHasContent)
                    .collect(Collectors.toCollection(ArrayList::new));
        }
    }

    public String getHeading() { return heading; }
    public String getHeadingEmphasis() { return headingEmphasis; }
    public QuoteItemModel getFeatured() { return featured; }
    public boolean isHasFeatured() { return featured != null && featured.isHasContent(); }
    public List<CardItemModel> getArticles() { return Collections.unmodifiableList(articles); }
    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading)
                || StringUtils.isNotBlank(headingEmphasis)
                || isHasFeatured()
                || (articles != null && !articles.isEmpty());
    }
}
