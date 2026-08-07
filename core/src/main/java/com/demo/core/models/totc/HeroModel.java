/*
 * TOTC Hero Sling Model.
 */
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
public class HeroModel {

    @ValueMapValue
    private String titlePrefix;

    @ValueMapValue
    private String titleRest;

    @ValueMapValue
    private String subtitle;

    @ValueMapValue
    @Default(values = "Join for free")
    private String primaryCtaLabel;

    @ValueMapValue
    private String primaryCtaLink;

    @ValueMapValue
    @Default(values = "Watch how it works")
    private String secondaryCtaLabel;

    @ValueMapValue
    private String secondaryCtaLink;

    @ValueMapValue
    private String heroImage;

    @ValueMapValue
    private String heroImageAlt;

    @ChildResource
    private List<FloatingCard> floatingCards;

    @PostConstruct
    protected void init() {
        if (floatingCards == null) {
            floatingCards = Collections.emptyList();
        } else {
            List<FloatingCard> filtered = new ArrayList<>();
            for (FloatingCard c : floatingCards) {
                if (c != null && c.hasContent()) {
                    filtered.add(c);
                }
            }
            floatingCards = Collections.unmodifiableList(filtered);
        }
    }

    public String getTitlePrefix() { return titlePrefix; }
    public String getTitleRest() { return titleRest; }
    public String getSubtitle() { return subtitle; }
    public String getPrimaryCtaLabel() { return primaryCtaLabel; }
    public String getPrimaryCtaLink() { return primaryCtaLink; }
    public String getSecondaryCtaLabel() { return secondaryCtaLabel; }
    public String getSecondaryCtaLink() { return secondaryCtaLink; }
    public String getHeroImage() { return heroImage; }
    public String getHeroImageAlt() { return heroImageAlt; }
    public List<FloatingCard> getFloatingCards() { return floatingCards; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(titlePrefix)
                || StringUtils.isNotBlank(titleRest)
                || StringUtils.isNotBlank(subtitle)
                || StringUtils.isNotBlank(heroImage)
                || !floatingCards.isEmpty();
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class FloatingCard {

        @ValueMapValue
        private String title;

        @ValueMapValue
        private String subtitle;

        @ValueMapValue
        @Default(values = "blue")
        private String iconStyle;

        @ValueMapValue
        private String ctaLabel;

        @ValueMapValue
        @Default(values = "topLeft")
        private String position;

        public String getTitle() { return title; }
        public String getSubtitle() { return subtitle; }
        public String getIconStyle() { return iconStyle; }
        public String getCtaLabel() { return ctaLabel; }
        public String getPosition() { return position; }

        public boolean hasContent() {
            return StringUtils.isNotBlank(title)
                    || StringUtils.isNotBlank(subtitle)
                    || StringUtils.isNotBlank(ctaLabel)
                    || "accent".equals(position);
        }
    }
}
