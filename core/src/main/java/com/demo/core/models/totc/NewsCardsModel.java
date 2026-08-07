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
public class NewsCardsModel {

    @ValueMapValue @Default(values = "NEWS") private String heroLabel;
    @ValueMapValue @Default(values = "pink") private String heroLabelColor;
    @ValueMapValue private String heroTitle;
    @ValueMapValue private String heroSummary;
    @ValueMapValue private String heroImage;
    @ValueMapValue @Default(values = "Read more") private String heroCta;

    @ChildResource
    private List<SideCard> sideCards;

    @PostConstruct
    protected void init() {
        if (sideCards == null) {
            sideCards = Collections.emptyList();
        } else {
            List<SideCard> filtered = new ArrayList<>();
            for (SideCard c : sideCards) {
                if (c != null && c.hasContent()) {
                    filtered.add(c);
                }
            }
            sideCards = Collections.unmodifiableList(filtered);
        }
    }

    public String getHeroLabel() { return heroLabel; }
    public String getHeroLabelColor() { return heroLabelColor; }
    public String getHeroTitle() { return heroTitle; }
    public String getHeroSummary() { return heroSummary; }
    public String getHeroImage() { return heroImage; }
    public String getHeroCta() { return heroCta; }
    public List<SideCard> getSideCards() { return sideCards; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(heroTitle) || !sideCards.isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class SideCard {
        @ValueMapValue private String title;
        @ValueMapValue private String summary;
        @ValueMapValue private String label;
        @ValueMapValue @Default(values = "pink") private String labelColor;
        @ValueMapValue private String image;

        public String getTitle() { return title; }
        public String getSummary() { return summary; }
        public String getLabel() { return label; }
        public String getLabelColor() { return labelColor; }
        public String getImage() { return image; }

        public boolean hasContent() {
            return StringUtils.isNotBlank(title);
        }
    }
}
