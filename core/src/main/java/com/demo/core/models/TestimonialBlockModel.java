/*
 *  Copyright 2025 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.stream.Collectors;
import javax.annotation.PostConstruct;

import org.apache.commons.lang3.StringUtils;
import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.Default;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class TestimonialBlockModel {

    @ValueMapValue
    private String quote;
    @ValueMapValue
    private String authorName;
    @ValueMapValue
    private String authorRole;
    @ValueMapValue
    private String imagePath;
    @ValueMapValue
    private String imageAlt;
    @ValueMapValue
    private String linkText;
    @ValueMapValue
    private String linkUrl;

    @ValueMapValue
    @Default(values = "md")
    private String sectionPadding;

    @ValueMapValue
    @Default(values = "white")
    private String backgroundColor;

    @ValueMapValue
    private String hexColor;

    @ChildResource
    private List<LogoEntry> logos;

    @PostConstruct
    protected void init() {
        if (logos == null) {
            logos = Collections.emptyList();
        } else {
            logos = logos.stream().filter(LogoEntry::isHasContent).collect(Collectors.toList());
        }
    }

    public String getQuote() { return quote; }
    public String getAuthorName() { return authorName; }
    public String getAuthorRole() { return authorRole; }
    public String getImagePath() { return imagePath; }
    public String getImageAlt() { return StringUtils.defaultString(imageAlt); }
    public String getLinkText() { return linkText; }
    public String getLinkUrl() { return linkUrl; }
    public String getSectionPadding() { return sectionPadding; }
    public String getBackgroundColor() { return backgroundColor; }

    public List<LogoEntry> getLogos() {
        return logos == null ? Collections.emptyList() : new ArrayList<>(logos);
    }

    public String getBackgroundStyle() {
        if ("other".equals(backgroundColor) && StringUtils.isNotBlank(hexColor)) {
            return "background-color: " + hexColor.trim() + ";";
        }
        return null;
    }

    public boolean isHasContent() {
        return StringUtils.isNotBlank(quote)
                || StringUtils.isNotBlank(authorName)
                || StringUtils.isNotBlank(imagePath);
    }

    @Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
    public static class LogoEntry {
        @ValueMapValue
        private String imagePath;
        @ValueMapValue
        private String imageAlt;

        public String getImagePath() { return imagePath; }
        public String getImageAlt() { return StringUtils.defaultString(imageAlt); }

        public boolean isHasContent() {
            return StringUtils.isNotBlank(imagePath);
        }
    }
}
