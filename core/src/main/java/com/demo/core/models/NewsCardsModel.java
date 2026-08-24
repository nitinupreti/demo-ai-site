/*
 * Copyright 2026 Demo AI Site
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

import javax.annotation.PostConstruct;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class NewsCardsModel {

    @ValueMapValue private String heading;
    @ChildResource private List<NewsCard> cards;

    @PostConstruct
    protected void init() {
        if (cards == null) { cards = Collections.emptyList(); return; }
        List<NewsCard> out = new ArrayList<>();
        for (NewsCard c : cards) {
            if (c != null && StringUtils.isNotBlank(c.getHeadline())) out.add(c);
        }
        cards = out;
    }

    public String getHeading() { return heading; }
    public List<NewsCard> getCards() { return cards; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heading) || (cards != null && !cards.isEmpty());
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class NewsCard {
        @ValueMapValue private String image;
        @ValueMapValue private String imageAlt;
        @ValueMapValue private String headline;
        @ValueMapValue private String description;
        @ValueMapValue private String link;
        @ValueMapValue private String linkLabel;
        public String getImage() { return image; }
        public String getImageAlt() { return imageAlt; }
        public String getHeadline() { return headline; }
        public String getDescription() { return description; }
        public String getLink() { return link; }
        public String getLinkLabel() { return linkLabel; }
    }
}
