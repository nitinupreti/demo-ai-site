/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

/**
 * Sling Model for the Positivus Services Grid (6-card marketing services layout).
 */
@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class ServicesModel {

    @ChildResource
    private List<ServiceCard> cards;

    private boolean hasContent;

    @PostConstruct
    protected void init() {
        if (cards == null) {
            cards = new ArrayList<>();
        } else {
            cards.removeIf(c -> c == null || !c.isHasContent());
        }
        hasContent = !cards.isEmpty();
    }

    public List<ServiceCard> getCards() {
        return Collections.unmodifiableList(cards);
    }

    public boolean isHasContent() {
        return hasContent;
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class ServiceCard {
        @ValueMapValue private String titleTop;
        @ValueMapValue private String titleBottom;
        @ValueMapValue private String illustration;
        @ValueMapValue @Default(values = "") private String illustrationAlt;
        @ValueMapValue private String linkText;
        @ValueMapValue @Default(values = "#") private String linkPath;
        @ValueMapValue @Default(values = "grey") private String variant;

        public String getTitleTop() { return titleTop; }
        public String getTitleBottom() { return titleBottom; }
        public String getIllustration() { return illustration; }
        public String getIllustrationAlt() { return illustrationAlt; }
        public String getLinkText() { return linkText; }
        public String getLinkPath() { return linkPath; }
        public String getVariant() { return variant; }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(titleTop) || StringUtils.isNotBlank(titleBottom);
        }
    }
}
