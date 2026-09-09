package com.demo.core.models;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(
        adaptables = Resource.class,
        defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL
)
public class Hero {

    @ValueMapValue
    private String eyebrow;

    @ValueMapValue
    private String headline;

    @ValueMapValue
    private String subhead;

    @ValueMapValue
    private String ctaLabel;

    @ValueMapValue
    private String ctaHref;

    @ValueMapValue
    private String secondaryLabel;

    @ValueMapValue
    private String secondaryHref;

    @ValueMapValue
    private String mediaPath;

    @ValueMapValue
    private String mediaAlt;

    @ValueMapValue
    private String brandLogoPath;

    @ValueMapValue
    private String brandLogoAlt;

    @ValueMapValue
    private String videoEmbedUrl;

    @ValueMapValue
    private String videoTitle;

    public String getEyebrow() { return eyebrow; }

    public String getHeadline() { return headline; }

    public String getSubhead() { return subhead; }

    public String getCtaLabel() { return ctaLabel; }

    public String getCtaHref() { return ctaHref; }

    public String getSecondaryLabel() { return secondaryLabel; }

    public String getSecondaryHref() { return secondaryHref; }

    public String getMediaPath() { return mediaPath; }

    public String getMediaAlt() { return mediaAlt == null ? "" : mediaAlt; }

    public String getBrandLogoPath() { return brandLogoPath; }

    public String getBrandLogoAlt() { return brandLogoAlt == null ? "" : brandLogoAlt; }

    public String getVideoEmbedUrl() { return videoEmbedUrl; }

    public String getVideoTitle() { return videoTitle; }

    public boolean isHasVideo() {
        return videoEmbedUrl != null && !videoEmbedUrl.trim().isEmpty();
    }

    public boolean isHasContent() {
        return headline != null && !headline.trim().isEmpty();
    }
}
