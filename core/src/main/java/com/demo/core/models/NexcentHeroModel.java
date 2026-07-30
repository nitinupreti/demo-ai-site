/*
 *  Copyright 2025 Adobe Systems Incorporated
 */
package com.demo.core.models;

import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class NexcentHeroModel {

    @ValueMapValue
    private String titlePrefix;

    @ValueMapValue
    private String titleAccent;

    @ValueMapValue
    private String description;

    @ValueMapValue
    private String ctaText;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String imagePath;

    @ValueMapValue
    private String imageAlt;

    @ValueMapValue
    @Default(values = "right")
    private String imagePosition;

    @ValueMapValue
    @Default(values = "lg")
    private String sectionPadding;

    @ValueMapValue
    @Default(values = "white")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    @PostConstruct
    protected void init() {
        // no-op
    }

    public String getTitlePrefix() { return titlePrefix; }
    public String getTitleAccent() { return titleAccent; }
    public String getDescription() { return description; }
    public String getCtaText() { return ctaText; }
    public String getCtaLink() { return ctaLink; }
    public String getImagePath() { return imagePath; }
    public String getImageAlt() { return StringUtils.defaultString(imageAlt); }
    public String getImagePosition() { return imagePosition; }
    public String getSectionPadding() { return sectionPadding; }
    public String getBackgroundColor() { return backgroundColor; }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(titlePrefix)
                || StringUtils.isNotBlank(titleAccent)
                || StringUtils.isNotBlank(description)
                || StringUtils.isNotBlank(imagePath);
    }
}
