package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class PullQuote {

    @ValueMapValue
    private String quoteText;

    @ValueMapValue
    private String attributionName;

    @ValueMapValue
    private String attributionRole;

    @ValueMapValue
    private String attributionImage;

    @ValueMapValue
    private String attributionImageAlt;

    public String getQuoteText() { return quoteText; }
    public String getAttributionName() { return attributionName; }
    public String getAttributionRole() { return attributionRole; }
    public String getAttributionImage() { return attributionImage; }
    public String getAttributionImageAlt() {
        return attributionImageAlt == null ? "" : attributionImageAlt;
    }

    public boolean isHasContent() { return quoteText != null && !quoteText.trim().isEmpty(); }
}
