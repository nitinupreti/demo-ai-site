package com.demo.core.models.totc;

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

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FeatureCardsModel {

    @ChildResource
    private List<Card> cards;

    @PostConstruct
    protected void init() {
        if (cards == null) {
            cards = Collections.emptyList();
        } else {
            List<Card> filtered = new ArrayList<>();
            for (Card c : cards) {
                if (c != null && c.hasContent()) {
                    filtered.add(c);
                }
            }
            cards = Collections.unmodifiableList(filtered);
        }
    }

    public List<Card> getCards() { return cards; }

    public boolean isHasContent() { return !cards.isEmpty(); }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class Card {
        @ValueMapValue private String title;
        @ValueMapValue private String description;
        @ValueMapValue @Default(values = "pink") private String iconVariant;
        @ValueMapValue @Default(values = "invoice") private String iconGlyph;

        public String getTitle() { return title; }
        public String getDescription() { return description; }
        public String getIconVariant() { return iconVariant; }
        public String getIconGlyph() { return iconGlyph; }

        public boolean hasContent() { return StringUtils.isNotBlank(title); }
    }
}
