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
public class PartnersModel {

    @ValueMapValue
    private String eyebrow;

    @ChildResource(name = "cards")
    private List<Resource> cardResources;

    private List<PartnerCard> cards;

    @PostConstruct
    protected void init() {
        cards = new ArrayList<>();
        if (cardResources != null) {
            for (Resource r : cardResources) {
                PartnerCard c = r.adaptTo(PartnerCard.class);
                if (c != null && c.isHasContent()) cards.add(c);
            }
        }
    }

    public String getEyebrow() { return eyebrow; }
    public List<PartnerCard> getCards() { return Collections.unmodifiableList(cards); }
    public boolean isHasContent() { return StringUtils.isNotBlank(eyebrow) || !cards.isEmpty(); }
}
