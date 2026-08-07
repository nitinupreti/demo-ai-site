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
public class SplitCardsModel {

    @ChildResource
    private List<SplitCard> cards;

    @PostConstruct
    protected void init() {
        if (cards == null) {
            cards = Collections.emptyList();
        } else {
            List<SplitCard> filtered = new ArrayList<>();
            for (SplitCard c : cards) {
                if (c != null && c.hasContent()) {
                    filtered.add(c);
                }
            }
            cards = Collections.unmodifiableList(filtered);
        }
    }

    public List<SplitCard> getCards() { return cards; }

    public boolean isHasContent() { return !cards.isEmpty(); }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class SplitCard {
        @ValueMapValue private String label;
        @ValueMapValue private String ctaLabel;
        @ValueMapValue private String ctaLink;
        @ValueMapValue private String backgroundImage;
        @ValueMapValue @Default(values = "pink") private String tint;

        public String getLabel() { return label; }
        public String getCtaLabel() { return ctaLabel; }
        public String getCtaLink() { return ctaLink; }
        public String getBackgroundImage() { return backgroundImage; }
        public String getTint() { return tint; }

        public boolean hasContent() {
            return StringUtils.isNotBlank(label) || StringUtils.isNotBlank(ctaLabel);
        }
    }
}
