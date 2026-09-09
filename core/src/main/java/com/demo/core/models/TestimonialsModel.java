package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TestimonialsModel {

    @ValueMapValue
    private String kicker;

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String intro;

    @ValueMapValue
    private String quote;

    @ValueMapValue
    private String authorName;

    @ValueMapValue
    private String authorMeta;

    @ValueMapValue
    private String image;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaLink;

    public String getKicker() { return kicker; }
    public String getTitle() { return title; }
    public String getIntro() { return intro; }
    public String getQuote() { return quote; }
    public String getAuthorName() { return authorName; }
    public String getAuthorMeta() { return authorMeta; }
    public String getImage() { return image; }
    public String getImageAlt() { return imageAlt == null ? "" : imageAlt; }
    public String getCtaLabel() { return ctaLabel; }
    public String getCtaLink() { return ctaLink == null ? "#" : ctaLink; }

    public boolean isHasContent() {
        return (title != null && !title.isEmpty()) || (quote != null && !quote.isEmpty()) || (authorName != null && !authorName.isEmpty());
    }
}
