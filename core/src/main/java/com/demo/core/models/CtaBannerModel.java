/*
 *  Copyright 2025 Adobe Systems Incorporated
 */
package com.demo.core.models;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class CtaBannerModel {

    @ValueMapValue
    private String title;

    @ValueMapValue
    private String ctaText;

    @ValueMapValue
    private String ctaLink;

    @ValueMapValue
    private String backgroundImage;

    @ValueMapValue
    @Default(values = "center")
    private String alignment;

    @ValueMapValue
    @Default(values = "md")
    private String sectionPadding;

    @ValueMapValue
    @Default(values = "dark")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    public String getTitle() { return title; }
    public String getCtaText() { return ctaText; }
    public String getCtaLink() { return ctaLink; }
    public String getBackgroundImage() { return backgroundImage; }
    public String getAlignment() { return alignment; }
    public String getSectionPadding() { return sectionPadding; }
    public String getBackgroundColor() { return backgroundColor; }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(title);
    }
}
