package com.demo.core.models.totc;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TestimonialModel {

    @ValueMapValue @Default(values = "TESTIMONIAL") private String eyebrow;
    @ValueMapValue private String title;
    @ValueMapValue private String lead;
    @ValueMapValue private String cta;
    @ValueMapValue private String quote;
    @ValueMapValue private String author;
    @ValueMapValue private String reviewSource;
    @ValueMapValue @Default(intValues = 5) private int rating;
    @ValueMapValue private String photo;
    @ValueMapValue private String photoAlt;

    public String getEyebrow() { return eyebrow; }
    public String getTitle() { return title; }
    public String getLead() { return lead; }
    public String getCta() { return cta; }
    public String getQuote() { return quote; }
    public String getAuthor() { return author; }
    public String getReviewSource() { return reviewSource; }
    public int getRating() { return rating; }
    public String getPhoto() { return photo; }
    public String getPhotoAlt() { return photoAlt; }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title)
                || StringUtils.isNotBlank(quote)
                || StringUtils.isNotBlank(author)
                || StringUtils.isNotBlank(photo);
    }
}
