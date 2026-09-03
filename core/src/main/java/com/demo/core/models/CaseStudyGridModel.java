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
public class CaseStudyGridModel {

    @ChildResource(name = "cards")
    private List<Resource> cardResources;

    @ValueMapValue
    private String viewAllLabel;

    @ValueMapValue
    private String viewAllLink;

    private List<InsightCard> cards;

    @PostConstruct
    protected void init() {
        cards = new ArrayList<>();
        if (cardResources != null) {
            for (Resource r : cardResources) {
                InsightCard c = r.adaptTo(InsightCard.class);
                if (c != null && c.isHasContent()) cards.add(c);
            }
        }
    }

    public List<InsightCard> getCards() { return Collections.unmodifiableList(cards); }
    public String getViewAllLabel() { return viewAllLabel; }

    public String getViewAllHref() {
        if (StringUtils.isBlank(viewAllLink)) return null;
        if (viewAllLink.startsWith("/content") && !viewAllLink.contains(".")) return viewAllLink + ".html";
        return viewAllLink;
    }

    public boolean isHasContent() { return !cards.isEmpty() || (StringUtils.isNotBlank(viewAllLabel) && StringUtils.isNotBlank(viewAllLink)); }
}
